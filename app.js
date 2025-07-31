document.addEventListener('DOMContentLoaded', () => {
    const photoUpload = document.getElementById('photo-upload');
    const photoListSection = document.getElementById('photo-list-section');
    const photoList = document.getElementById('photo-list');
    const startNavigationBtn = document.getElementById('start-navigation-btn');
    const mapSection = document.getElementById('map-section');
    const mapContainer = document.getElementById('map');
    const navigationSection = document.getElementById('navigation-section');
    const navigationPrompt = document.getElementById('navigation-prompt');
    const nextLocationBtn = document.getElementById('next-location-btn');
    const offlineNotice = document.getElementById('offline-map-notice');

    let photoMetadata = [];
    let map;
    let routePolyline;
    let mapMarkers = [];
    let navigationIndex = 0;

    // Handle photo uploads
    photoUpload.addEventListener('change', (event) => {
        const files = event.target.files;
        if (files.length > 0) {
            photoMetadata = [];
            photoList.innerHTML = '';
            processFiles(Array.from(files));
        }
    });

    // Process each uploaded file
    async function processFiles(files) {
        for (const file of files) {
            try {
                const data = await getExifData(file);
                if (data) {
                    photoMetadata.push(data);
                } else {
                    alert(`Could not find GPS data for ${file.name}.`);
                }
            } catch (error) {
                console.error("Error processing file:", file.name, error);
            }
        }
        if (photoMetadata.length > 0) {
            displayPhotoList();
            photoListSection.classList.remove('hidden');
        }
    }

    // Extract EXIF data from a photo
    function getExifData(file) {
        return new Promise((resolve, reject) => {
            EXIF.getData(file, function() {
                const lat = EXIF.getTag(this, "GPSLatitude");
                const lon = EXIF.getTag(this, "GPSLongitude");

                if (lat && lon) {
                    const latRef = EXIF.getTag(this, "GPSLatitudeRef") || "N";
                    const lonRef = EXIF.getTag(this, "GPSLongitudeRef") || "W";
                    const direction = EXIF.getTag(this, "GPSImgDirection");
                    const decimalLat = convertDMSToDD(lat, latRef);
                    const decimalLon = convertDMSToDD(lon, lonRef);

                    const reader = new FileReader();
                    reader.onload = e => {
                        resolve({
                            fileName: file.name,
                            lat: decimalLat,
                            lon: decimalLon,
                            direction: direction ? Math.round(direction) : 'N/A',
                            thumbnail: e.target.result
                        });
                    };
                    reader.readAsDataURL(file);
                } else {
                    resolve(null);
                }
            });
        });
    }

    // Convert GPS coordinates from DMS to Decimal Degrees
    function convertDMSToDD(dms, ref) {
        let dd = dms[0] + dms[1] / 60 + dms[2] / 3600;
        if (ref === "S" || ref === "W") {
            dd = dd * -1;
        }
        return dd;
    }

    // Display the list of photos for ordering
    function displayPhotoList() {
        photoList.innerHTML = '';
        photoMetadata.forEach((data, index) => {
            const listItem = document.createElement('li');
            listItem.draggable = true;
            listItem.dataset.originalIndex = index;
            listItem.innerHTML = `<img src="${data.thumbnail}" alt="${data.fileName}"> <span>${data.fileName}</span>`;
            photoList.appendChild(listItem);
        });
        addDragAndDropListeners();
    }

    // Add drag and drop functionality to the list
    function addDragAndDropListeners() {
        const listItems = photoList.querySelectorAll('li');
        let draggedItem = null;

        listItems.forEach(item => {
            item.addEventListener('dragstart', () => {
                draggedItem = item;
                setTimeout(() => item.classList.add('dragging'), 0);
            });

            item.addEventListener('dragend', () => {
                setTimeout(() => {
                    draggedItem.classList.remove('dragging');
                    draggedItem = null;
                    updatePhotoOrder();
                }, 0);
            });
        });

        photoList.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = getDragAfterElement(photoList, e.clientY);
            if (draggedItem) {
                if (afterElement == null) {
                    photoList.appendChild(draggedItem);
                } else {
                    photoList.insertBefore(draggedItem, afterElement);
                }
            }
        });
    }

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('li:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // Update the order of photos in the metadata array based on DOM order
    function updatePhotoOrder() {
        const newOrderedMetadata = [];
        photoList.querySelectorAll('li').forEach(item => {
            const originalIndex = parseInt(item.dataset.originalIndex, 10);
            newOrderedMetadata.push(photoMetadata.find((meta, index) => index === originalIndex));
        });
        photoMetadata = newOrderedMetadata;
        
        const originalData = [...photoMetadata];
        photoList.querySelectorAll('li').forEach((item, newIndex) => {
             const oldIndex = parseInt(item.dataset.originalIndex);
             const data = originalData.find((d,i) => i === oldIndex);
             photoMetadata[newIndex] = data;
        });

        // Re-render list to reset indices for future drags
        displayPhotoList();
    }

    // Start the navigation
    startNavigationBtn.addEventListener('click', () => {
        if (photoMetadata.length === 0) return;
        mapSection.classList.remove('hidden');
        navigationSection.classList.remove('hidden');
        initializeMap();
        drawRoute();
        startNavigating();
    });

    // Initialize the map
    function initializeMap() {
        if (!map) {
            map = L.map(mapContainer).setView([photoMetadata[0].lat, photoMetadata[0].lon], 16);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(map);
        }
        // Check if the browser is offline and show a notice if so
        if (!navigator.onLine) {
            offlineNotice.classList.remove('hidden');
        } else {
            offlineNotice.classList.add('hidden');
        }
    }

    // Draw the route on the map
    function drawRoute() {
        // Clear previous route and markers
        if (routePolyline) map.removeLayer(routePolyline);
        mapMarkers.forEach(marker => map.removeLayer(marker));
        mapMarkers = [];

        const latLngs = photoMetadata.map(p => [p.lat, p.lon]);
        routePolyline = L.polyline(latLngs, { color: 'blue' }).addTo(map);
        map.fitBounds(routePolyline.getBounds().pad(0.1));

        photoMetadata.forEach((p, index) => {
            const marker = L.marker([p.lat, p.lon]).addTo(map)
                .bindPopup(`<b>Point ${index + 1}</b><br>${p.fileName}`);
            mapMarkers.push(marker);
        });
    }

    // Begin the turn-by-turn navigation
    function startNavigating() {
        navigationIndex = 0;
        updateNavigationPrompt();
        nextLocationBtn.classList.remove('hidden');
    }

    // Update the navigation prompt for the current location
    function updateNavigationPrompt() {
        const currentPoint = photoMetadata[navigationIndex];
        mapMarkers.forEach((marker, index) => {
            marker.setOpacity(index === navigationIndex ? 1.0 : 0.5);
            if (index === navigationIndex) {
                marker.openPopup();
                map.panTo(marker.getLatLng());
            }
        });

        navigationPrompt.innerHTML = `
            <p>Navigate to <strong>Point ${navigationIndex + 1}</strong>.</p>
            <p>Once you arrive, please orient yourself to face <strong>${currentPoint.direction}°</strong>.</p>
            <small>${currentPoint.fileName}</small>
        `;
    }

    // Handle "I've Arrived" button click
    nextLocationBtn.addEventListener('click', () => {
        navigationIndex++;
        if (navigationIndex < photoMetadata.length) {
            updateNavigationPrompt();
        } else {
            navigationPrompt.innerHTML = '<p><strong>Route complete!</strong></p>';
            nextLocationBtn.classList.add('hidden');
            mapMarkers.forEach(marker => marker.setOpacity(1.0));
        }
    });
});