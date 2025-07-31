document.addEventListener('DOMContentLoaded', () => {
    // --- Existing DOM Element References ---
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

    // --- New DOM Element References for Camera ---
    const takePhotoBtn = document.getElementById('take-photo-btn');
    const cameraModal = document.getElementById('camera-modal');
    const cameraView = document.getElementById('camera-view');
    const photoCanvas = document.getElementById('photo-canvas');
    const captureBtn = document.getElementById('capture-btn');
    const cancelCameraBtn = document.getElementById('cancel-camera-btn');
    const directionDisplay = document.getElementById('camera-direction-display');

    // --- State Variables ---
    let photoMetadata = [];
    let map;
    let routePolyline;
    let mapMarkers = [];
    let navigationIndex = 0;
    let currentStream;
    let currentDirection = 0;

    // =================================================================
    // NEW CAMERA AND SENSORS LOGIC
    // =================================================================

    takePhotoBtn.addEventListener('click', startCamera);
    cancelCameraBtn.addEventListener('click', stopCamera);
    captureBtn.addEventListener('click', capturePhoto);

    function startCamera() {
        // First, request permissions for camera
        navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }, // Use the rear camera
            audio: false
        })
        .then(stream => {
            currentStream = stream;
            cameraView.srcObject = stream;
            cameraModal.classList.remove('hidden');
            startOrientationSensor(); // Start listening to compass
        })
        .catch(err => {
            console.error("Error accessing camera:", err);
            alert("Could not access camera. Please ensure you have given permission in your browser or device settings.");
        });
    }

    function stopCamera() {
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
        }
        cameraModal.classList.add('hidden');
        stopOrientationSensor();
    }

    // Access compass data (device orientation)
    function startOrientationSensor() {
        if ('DeviceOrientationEvent' in window) {
             // iOS 13+ requires a specific permission request for this event
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission()
                    .then(permissionState => {
                        if (permissionState === 'granted') {
                             window.addEventListener('deviceorientation', handleOrientation);
                        } else {
                            alert("Permission for compass was not granted.");
                        }
                    })
                    .catch(console.error);
            } else {
                // Handle non-iOS 13+ devices which don't require explicit permission
                window.addEventListener('deviceorientation', handleOrientation);
            }
        } else {
            alert("Device orientation (compass) not supported on this device/browser.");
        }
    }
    
    function stopOrientationSensor() {
        window.removeEventListener('deviceorientation', handleOrientation);
    }

    function handleOrientation(event) {
        // webkitCompassHeading is a Safari-specific property for iOS
        const heading = event.webkitCompassHeading || event.alpha;
        if (heading !== null) {
            currentDirection = Math.round(heading);
            directionDisplay.textContent = `Direction: ${currentDirection}°`;
        }
    }

    function capturePhoto() {
        // Get high-accuracy location when the capture button is pressed
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;

                // Draw the current video frame to a hidden canvas
                const context = photoCanvas.getContext('2d');
                photoCanvas.width = cameraView.videoWidth;
                photoCanvas.height = cameraView.videoHeight;
                context.drawImage(cameraView, 0, 0, photoCanvas.width, photoCanvas.height);

                // Create a jpeg image from the canvas
                const thumbnail = photoCanvas.toDataURL('image/jpeg');

                // Combine the captured data into one object
                const newPhotoData = {
                    fileName: `capture_${Date.now()}.jpg`,
                    lat: latitude,
                    lon: longitude,
                    direction: currentDirection,
                    thumbnail: thumbnail
                };

                photoMetadata.push(newPhotoData);
                displayPhotoList();
                photoListSection.classList.remove('hidden');

                // Clean up
                stopCamera();
            },
            (error) => {
                console.error("Error getting location:", error);
                alert("Could not get your location. Please ensure location services are enabled and permission is granted.");
            },
            {
                enableHighAccuracy: true, // Request the most accurate location possible
                timeout: 10000,
                maximumAge: 0
            }
        );
    }


    // =================================================================
    // EXISTING PHOTO UPLOAD AND PROCESSING LOGIC (Fallback)
    // =================================================================
    
    photoUpload.addEventListener('change', (event) => {
        const files = event.target.files;
        if (files.length > 0) {
            processUploadedFiles(Array.from(files));
        }
    });

    async function processUploadedFiles(files) {
        for (const file of files) {
            try {
                const data = await getExifData(file);
                if (data) {
                    photoMetadata.push(data);
                } else {
                    alert(`Could not find GPS data for uploaded photo: ${file.name}.`);
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

    function getExifData(file) {
        return new Promise((resolve) => {
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

    function convertDMSToDD(dms, ref) {
        let dd = dms[0] + dms[1] / 60 + dms[2] / 3600;
        if (ref === "S" || ref === "W") {
            dd = dd * -1;
        }
        return dd;
    }

    // =================================================================
    // UI, MAP, AND NAVIGATION LOGIC
    // =================================================================

    function displayPhotoList() {
        photoList.innerHTML = '';
        photoMetadata.forEach((data, index) => {
            const listItem = document.createElement('li');
            listItem.draggable = true;
            listItem.dataset.index = index; // This index is crucial for reordering
            listItem.innerHTML = `<img src="${data.thumbnail}" alt="${data.fileName}"> <span>${data.fileName}</span>`;
            photoList.appendChild(listItem);
        });
        addDragAndDropListeners();
    }

    function addDragAndDropListeners() {
        const listItems = photoList.querySelectorAll('li');
        let draggedItem = null;

        listItems.forEach(item => {
            item.addEventListener('dragstart', () => {
                draggedItem = item;
                setTimeout(() => item.classList.add('dragging'), 0);
            });
            item.addEventListener('dragend', () => {
                if (draggedItem) {
                    draggedItem.classList.remove('dragging');
                }
                draggedItem = null;
                updatePhotoOrder();
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

    function updatePhotoOrder() {
        const newOrderedMetadata = [];
        // Read the new order from the DOM
        photoList.querySelectorAll('li').forEach(item => {
            const originalIndex = parseInt(item.dataset.index, 10);
            newOrderedMetadata.push(photoMetadata[originalIndex]);
        });
        // Replace the old array with the newly ordered one
        photoMetadata = newOrderedMetadata;
        // Re-render the list to update the data-index attributes for the next drag
        displayPhotoList();
    }

    startNavigationBtn.addEventListener('click', () => {
        if (photoMetadata.length === 0) return;
        mapSection.classList.remove('hidden');
        navigationSection.classList.remove('hidden');
        initializeMap();
        drawRoute();
        startNavigating();
    });

    function initializeMap() {
        if (!map) {
            map = L.map(mapContainer).setView([photoMetadata[0].lat, photoMetadata[0].lon], 16);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(map);
        }
        if (!navigator.onLine) {
            offlineNotice.classList.remove('hidden');
        } else {
            offlineNotice.classList.add('hidden');
        }
    }

    function drawRoute() {
        if (routePolyline) map.removeLayer(routePolyline);
        mapMarkers.forEach(marker => map.removeLayer(marker));
        mapMarkers = [];
        const latLngs = photoMetadata.map(p => [p.lat, p.lon]);
        routePolyline = L.polyline(latLngs, { color: 'blue' }).addTo(map);
        map.fitBounds(routePolyline.getBounds().pad(0.1));
        photoMetadata.forEach((p, index) => {
            const marker = L.marker([p.lat, p.lon]).addTo(map).bindPopup(`<b>Point ${index + 1}</b><br>${p.fileName}`);
            mapMarkers.push(marker);
        });
    }

    function startNavigating() {
        navigationIndex = 0;
        updateNavigationPrompt();
        nextLocationBtn.classList.remove('hidden');
    }

    function updateNavigationPrompt() {
        const currentPoint = photoMetadata[navigationIndex];
        mapMarkers.forEach((marker, index) => {
            marker.setOpacity(index === navigationIndex ? 1.0 : 0.6);
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
