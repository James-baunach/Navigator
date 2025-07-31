document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element References ---
    const photoUpload = document.getElementById('photo-upload');
    const initialActions = document.getElementById('initial-actions');
    const photoListSection = document.getElementById('photo-list-section');
    const photoList = document.getElementById('photo-list');
    const startNavigationBtn = document.getElementById('start-navigation-btn');
    const mapSection = document.getElementById('map-section');
    const mapContainer = document.getElementById('map');
    const navigationSection = document.getElementById('navigation-section');
    const navigationPrompt = document.getElementById('navigation-prompt');
    const nextLocationBtn = document.getElementById('next-location-btn');
    const offlineNotice = document.getElementById('offline-map-notice');
    const takePhotoBtn = document.getElementById('take-photo-btn');
    const cameraModal = document.getElementById('camera-modal');
    const cameraView = document.getElementById('camera-view');
    const photoCanvas = document.getElementById('photo-canvas');
    const captureBtn = document.getElementById('capture-btn');
    const cancelCameraBtn = document.getElementById('cancel-camera-btn');
    const directionDisplay = document.getElementById('camera-direction-display');
    const saveProjectBtn = document.getElementById('save-project-btn');
    const projectNameInput = document.getElementById('project-name');
    const loadProjectBtn = document.getElementById('load-project-btn');
    const loadProjectModal = document.getElementById('load-project-modal');
    const savedProjectsList = document.getElementById('saved-projects-list');
    const cancelLoadBtn = document.getElementById('cancel-load-btn');
    const downloadMapBtn = document.getElementById('download-map-btn');

    // --- State Variables ---
    let photoMetadata = [];
    let map;
    let db; // For IndexedDB
    let routePolyline;
    let mapMarkers = [];
    let navigationIndex = 0;
    let currentStream;
    let currentDirection = 0;

    // =================================================================
    // DATABASE (INDEXEDDB) LOGIC
    // =================================================================
    function initDb() {
        const request = indexedDB.open('PropertyNavigatorDB', 1);

        request.onupgradeneeded = event => {
            db = event.target.result;
            db.createObjectStore('projects', { keyPath: 'name' });
        };

        request.onsuccess = event => {
            db = event.target.result;
        };

        request.onerror = event => {
            console.error('Database error:', event.target.errorCode);
        };
    }

    function saveProject(name, photos) {
        if (!db) return;
        const transaction = db.transaction(['projects'], 'readwrite');
        const store = transaction.objectStore('projects');
        store.put({ name: name, photos: photos });
        transaction.oncomplete = () => {
            alert(`Project "${name}" saved!`);
        };
        transaction.onerror = () => {
            alert(`Error saving project "${name}". Please try a different name.`);
        };
    }

    function loadProjects() {
        if (!db) return;
        const transaction = db.transaction(['projects'], 'readonly');
        const store = transaction.objectStore('projects');
        const request = store.getAll();

        request.onsuccess = () => {
            displaySavedProjects(request.result);
        };
    }
    
    function deleteProject(name) {
        if (!db) return;
        const transaction = db.transaction(['projects'], 'readwrite');
        const store = transaction.objectStore('projects');
        const request = store.delete(name);
        request.onsuccess = () => {
            alert(`Project "${name}" deleted.`);
            loadProjects(); // Refresh the list
        }
    }

    // =================================================================
    // UI AND EVENT LISTENERS
    // =================================================================
    
    initDb(); // Initialize the database on load

    // --- Button Clicks ---
    takePhotoBtn.addEventListener('click', startCamera);
    cancelCameraBtn.addEventListener('click', stopCamera);
    captureBtn.addEventListener('click', capturePhoto);
    photoUpload.addEventListener('change', handleFileUpload);
    saveProjectBtn.addEventListener('click', handleSaveProject);
    loadProjectBtn.addEventListener('click', () => {
        loadProjects();
        loadProjectModal.classList.remove('hidden');
    });
    cancelLoadBtn.addEventListener('click', () => loadProjectModal.classList.add('hidden'));
    downloadMapBtn.addEventListener('click', handleDownloadMap);


    function handleSaveProject() {
        const name = projectNameInput.value.trim();
        if (!name) {
            alert('Please enter a project name.');
            return;
        }
        if (photoMetadata.length === 0) {
            alert('Add some photos before saving a project.');
            return;
        }
        saveProject(name, photoMetadata);
    }
    
    function handleFileUpload(event) {
        const files = event.target.files;
        if (files.length > 0) {
            // Reset current project state when uploading new files to start fresh
            photoMetadata = [];
            projectNameInput.value = '';
            processUploadedFiles(Array.from(files));
        }
    }

    function displaySavedProjects(projects) {
        savedProjectsList.innerHTML = '';
        if (projects.length === 0) {
            savedProjectsList.innerHTML = '<li>No saved projects found.</li>';
            return;
        }
        projects.forEach(project => {
            const li = document.createElement('li');
            li.textContent = project.name;
            li.dataset.projectName = project.name;

            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '&times;';
            deleteBtn.className = 'delete-project-btn';
            deleteBtn.title = `Delete ${project.name}`;
            
            deleteBtn.onclick = (e) => {
                e.stopPropagation(); // prevent li click event from firing
                if (confirm(`Are you sure you want to delete project "${project.name}"?`)) {
                    deleteProject(project.name);
                }
            };
            
            li.appendChild(deleteBtn);
            li.onclick = () => {
                loadProjectData(project);
            };
            savedProjectsList.appendChild(li);
        });
    }
    
    function loadProjectData(project) {
        photoMetadata = project.photos;
        projectNameInput.value = project.name;
        displayPhotoList();
        photoListSection.classList.remove('hidden');
        initialActions.classList.add('hidden');
        loadProjectModal.classList.add('hidden');
    }

    // =================================================================
    // CAMERA AND PHOTO CAPTURE
    // =================================================================

    function startCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert("Camera access is not supported by your browser.");
            return;
        }
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then(stream => {
            currentStream = stream;
            cameraView.srcObject = stream;
            cameraModal.classList.remove('hidden');
            startOrientationSensor();
        })
        .catch(err => {
            console.error("Error accessing camera:", err);
            let message = "Could not access camera. Please ensure you 'Allow' access when prompted.";
            if (err.name === "NotAllowedError") message = "Camera access was denied. Please go to your browser's settings for this site and re-enable camera permission.";
            else if (err.name === "NotFoundError") message = "No rear camera was found on your device.";
            alert(message);
        });
    }

    function stopCamera() {
        if (currentStream) currentStream.getTracks().forEach(track => track.stop());
        cameraModal.classList.add('hidden');
        stopOrientationSensor();
    }

    function capturePhoto() {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                const context = photoCanvas.getContext('2d');
                photoCanvas.width = cameraView.videoWidth;
                photoCanvas.height = cameraView.videoHeight;
                context.drawImage(cameraView, 0, 0, photoCanvas.width, photoCanvas.height);

                // --- NEW: Save photo to device's downloads folder ---
                photoCanvas.toBlob(blob => {
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    const fileName = `capture_${Date.now()}.jpg`;
                    link.download = fileName;
                    link.click();
                    URL.revokeObjectURL(link.href);
                }, 'image/jpeg');

                const thumbnail = photoCanvas.toDataURL('image/jpeg');
                const newPhotoData = { fileName: `capture_${Date.now()}.jpg`, lat: latitude, lon: longitude, direction: currentDirection, thumbnail: thumbnail };

                photoMetadata.push(newPhotoData);
                displayPhotoList();
                stopCamera();
            },
            (error) => {
                console.error("Error getting location:", error);
                let message = "Could not get your location.";
                switch(error.code) {
                    case error.PERMISSION_DENIED: message = "Location access was denied. Please go to your browser's site settings and re-enable location permission."; break;
                    case error.POSITION_UNAVAILABLE: message = "Location information is currently unavailable. Check GPS signal."; break;
                    case error.TIMEOUT: message = "The request to get your location timed out. Please try again."; break;
                }
                alert(message);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    }
    
    function startOrientationSensor() {
        if ('DeviceOrientationEvent' in window) {
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission().then(state => {
                    if (state === 'granted') window.addEventListener('deviceorientation', handleOrientation);
                }).catch(console.error);
            } else {
                window.addEventListener('deviceorientation', handleOrientation);
            }
        }
    }
    function stopOrientationSensor() { window.removeEventListener('deviceorientation', handleOrientation); }
    function handleOrientation(event) {
        const heading = event.webkitCompassHeading || event.alpha;
        if (heading !== null) {
            currentDirection = Math.round(heading);
            directionDisplay.textContent = `Direction: ${currentDirection}°`;
        }
    }

    // =================================================================
    // PHOTO LIST MANAGEMENT
    // =================================================================

    function displayPhotoList() {
        photoList.innerHTML = '';
        photoMetadata.forEach((data, index) => {
            const listItem = document.createElement('li');
            listItem.draggable = true;
            listItem.dataset.index = index;

            listItem.innerHTML = `
                <img src="${data.thumbnail}" alt="${data.fileName}">
                <span>${data.fileName}</span>
                <button class="remove-photo-btn" title="Remove Photo">&times;</button>
            `;
            
            listItem.querySelector('.remove-photo-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                removePhoto(index);
            });
            
            photoList.appendChild(listItem);
        });
        addDragAndDropListeners();
        
        if(photoMetadata.length > 0) {
            photoListSection.classList.remove('hidden');
            initialActions.classList.add('hidden');
        } else {
            photoListSection.classList.add('hidden');
            initialActions.classList.remove('hidden');
        }
    }

    function removePhoto(index) {
        photoMetadata.splice(index, 1);
        displayPhotoList();
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
                if (draggedItem) draggedItem.classList.remove('dragging');
                draggedItem = null;
                updatePhotoOrder();
            });
        });
        photoList.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = getDragAfterElement(photoList, e.clientY);
            if (draggedItem) {
                if (afterElement == null) photoList.appendChild(draggedItem);
                else photoList.insertBefore(draggedItem, afterElement);
            }
        });
    }

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('li:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) return { offset, element: child };
            else return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    function updatePhotoOrder() {
        const newOrderedMetadata = [];
        photoList.querySelectorAll('li').forEach(item => {
            newOrderedMetadata.push(photoMetadata[parseInt(item.dataset.index, 10)]);
        });
        photoMetadata = newOrderedMetadata;
        displayPhotoList(); // Re-render to update indices for the next drag
    }
    
    async function processUploadedFiles(files) {
        for (const file of files) {
            const data = await getExifData(file);
            if (data) photoMetadata.push(data);
            else alert(`Could not find GPS data for uploaded photo: ${file.name}.`);
        }
        displayPhotoList();
    }

    function getExifData(file) { return new Promise(r => { EXIF.getData(file, function() { const lat = EXIF.getTag(this, "GPSLatitude"), lon = EXIF.getTag(this, "GPSLongitude"); if (lat && lon) { const latRef = EXIF.getTag(this, "GPSLatitudeRef") || "N", lonRef = EXIF.getTag(this, "GPSLongitudeRef") || "W", dir = EXIF.getTag(this, "GPSImgDirection"), decLat = convertDMSToDD(lat, latRef), decLon = convertDMSToDD(lon, lonRef); const reader = new FileReader(); reader.onload = e => r({ fileName: file.name, lat: decLat, lon: decLon, direction: dir ? Math.round(dir) : 'N/A', thumbnail: e.target.result }); reader.readAsDataURL(file); } else { r(null) } }); }); }
    function convertDMSToDD(dms, ref) { let dd = dms[0] + dms[1] / 60 + dms[2] / 3600; if (ref === "S" || ref === "W") dd *= -1; return dd; }


    // =================================================================
    // MAP, NAVIGATION, AND OFFLINE CACHING
    // =================================================================

    startNavigationBtn.addEventListener('click', () => {
        if (photoMetadata.length === 0) return;
        mapSection.classList.remove('hidden');
        navigationSection.classList.remove('hidden');
        photoListSection.classList.add('hidden'); // Hide list during navigation
        initializeMap();
        drawRoute();
        startNavigating();
    });
    
    function handleDownloadMap() {
        if (!map || !routePolyline) { alert('Please plan a route first.'); return; }
        if (!navigator.serviceWorker || !navigator.serviceWorker.controller) { alert("Service worker not active. Cannot download map."); return; }

        const bounds = routePolyline.getBounds().pad(0.1); // Add padding
        const zoomLevels = [13, 14, 15, 16, 17, 18]; // More zoom levels
        let tileUrls = [];

        zoomLevels.forEach(zoom => {
            const minTile = getTileNumber(bounds.getNorthWest().lat, bounds.getNorthWest().lng, zoom);
            const maxTile = getTileNumber(bounds.getSouthEast().lat, bounds.getSouthEast().lng, zoom);
            for (let x = minTile.x; x <= maxTile.x; x++) {
                for (let y = minTile.y; y <= maxTile.y; y++) {
                    tileUrls.push(`https://a.tile.openstreetmap.org/${zoom}/${x}/${y}.png`);
                    tileUrls.push(`https://b.tile.openstreetmap.org/${zoom}/${x}/${y}.png`);
                    tileUrls.push(`https://c.tile.openstreetmap.org/${zoom}/${x}/${y}.png`);
                }
            }
        });
        
        tileUrls = [...new Set(tileUrls)]; // Remove duplicates
        alert(`Attempting to download map tiles for offline use. This may take a moment. The app may be slow during download.`);

        navigator.serviceWorker.controller.postMessage({ action: 'cache-tiles', urls: tileUrls });
    }

    function getTileNumber(lat, lon, zoom) {
        const n = Math.pow(2, zoom);
        const xtile = Math.floor(n * ((lon + 180) / 360));
        const lat_rad = lat * Math.PI / 180;
        const ytile = Math.floor(n * (1 - (Math.log(Math.tan(lat_rad) + 1 / Math.cos(lat_rad)) / Math.PI)) / 2);
        return { x: xtile, y: ytile };
    }

    function initializeMap() { if (!map) { map = L.map(mapContainer).setView([photoMetadata[0].lat, photoMetadata[0].lon], 16); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(map); } if (!navigator.onLine) offlineNotice.classList.remove('hidden'); else offlineNotice.classList.add('hidden'); }
    function drawRoute() { if (routePolyline) map.removeLayer(routePolyline); mapMarkers.forEach(marker => map.removeLayer(marker)); mapMarkers = []; const latLngs = photoMetadata.map(p => [p.lat, p.lon]); routePolyline = L.polyline(latLngs, { color: 'blue' }).addTo(map); map.fitBounds(routePolyline.getBounds().pad(0.1)); photoMetadata.forEach((p, index) => { const marker = L.marker([p.lat, p.lon]).addTo(map).bindPopup(`<b>Point ${index + 1}</b><br>${p.fileName}`); mapMarkers.push(marker); }); }
    function startNavigating() { navigationIndex = 0; updateNavigationPrompt(); nextLocationBtn.classList.remove('hidden'); }
    function updateNavigationPrompt() { const currentPoint = photoMetadata[navigationIndex]; mapMarkers.forEach((marker, index) => { marker.setOpacity(index === navigationIndex ? 1.0 : 0.6); if (index === navigationIndex) { marker.openPopup(); map.panTo(marker.getLatLng()); } }); navigationPrompt.innerHTML = `<p>Navigate to <strong>Point ${navigationIndex + 1}</strong>.</p><p>Once you arrive, please orient yourself to face <strong>${currentPoint.direction}°</strong>.</p><small>${currentPoint.fileName}</small>`; }
    nextLocationBtn.addEventListener('click', () => { navigationIndex++; if (navigationIndex < photoMetadata.length) { updateNavigationPrompt(); } else { navigationPrompt.innerHTML = '<p><strong>Route complete!</strong></p>'; nextLocationBtn.classList.add('hidden'); mapMarkers.forEach(marker => marker.setOpacity(1.0)); } });
});
