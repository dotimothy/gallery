
import { View3D } from './view3d.js';
import { View2D } from './view2d.js';

class App {
    constructor() {
        this.mode = '3D'; // Start in 3D
        this.currentIndex = 0;
        this.images = [];
        this.metadata = {};
        this.isMobile = (typeof window.orientation !== "undefined") || (navigator.userAgent.indexOf('IEMobile') !== -1);

        // Touch State
        this.touchStartX = 0;
        this.touchEndX = 0;
        this.swipeThresh = 75;

        // Elements
        this.ui = {
            title: document.getElementById('title'),
            toggle: document.getElementById('mode-toggle'),
            topControls: document.getElementById('top-controls'), // Added
            metadataViewer: document.getElementById('metadataViewer'),
            toggleMetadata: document.getElementById('toggleMetadata'),
            globalFullscreen: document.getElementById('global-fullscreen'),
            imageViewer: document.getElementById('imageViewer'),
            exitViewer: document.getElementById('exitViewer'),
            fullscreenToggle: document.getElementById('fullscreenToggle'),
            fullImageContainer: document.getElementById('full-image-container'),
            leftArrow: document.getElementById('leftArrow'),
            rightArrow: document.getElementById('rightArrow'),
            lightPollutionOverlay: document.getElementById('lightPollutionMapOverlay'),
            lightPollutionClose: document.getElementById('lightPollutionMapCloseButton'),
            lightPollutionIframe: document.getElementById('lightPollutionMapIframe'),
            loadingScreen: document.getElementById('loading-screen'),
        };

        // Initialize Views
        this.view3d = new View3D(document.getElementById('gallery-3d'));
        this.view3d.init(this.images,
            (index, openViewer) => this.selectImage(index, openViewer),
            (index) => this.preloadHighRes(index)
        );

        this.view2d = new View2D(document.getElementById('gallery-2d'));
        this.view2d.init(this.images, (index) => this.selectImage(index, true));

        this.bindEvents();
        this.loadData();
    }

    async loadData() {
        try {
            // 1. Try Loading Metadata
            const response = await fetch('./metadata/metadata.json');
            if (!response.ok) throw new Error("Metadata check failed");
            const data = await response.json();

            // 2. Parse Data
            this.metadata = data;
            // image_order contains filenames without extension/path based on viewing file
            // Actually the file says "image_order": ["0", "1", ...]
            // And keys are "0", "1".
            // So we can use image_order directly.
            this.images = data.image_order || Object.keys(data).filter(k => k !== 'image_order');

            console.log("Loaded metadata with", this.images.length, "images.");

            // 3. Preload Thumbnails (Blocking)
            await this.preloadAllThumbnails();

            // 4. Start App
            setTimeout(() => {
                if (this.ui.loadingScreen) this.ui.loadingScreen.classList.add('hidden');

                // 5. Silent Background Preload of Full Images
                this.preloadFullImages();

            }, 500);

            // 6. Init 3D View
            this.view3d.init(
                this.images,
                (index, openViewer) => this.selectImage(index, openViewer), // Original selectImage
                (index) => this.preloadHighRes(index) // Original preloadHighRes
            );

            // 7. Init 2D View
            this.view2d.init(this.images, (index) => this.selectImage(index, true)); // Original selectImage

            // 8. Apply initial state and URL params (moved from original initViews)
            this.switchMode(this.mode); // Initial State

            const urlParams = new URLSearchParams(window.location.search);
            this.useDataSaver = urlParams.has('datasaver');

            if (urlParams.get('mode') === '2d' || urlParams.has('gallery')) {
                this.switchMode('2D');
            }

            // Initial Selection (Deep link)
            let initialIndex = 0;
            const targetImg = urlParams.get('img');
            if (targetImg) {
                const idx = this.images.indexOf(targetImg.replace('.jpg', ''));
                if (idx !== -1) initialIndex = idx;
            }
            this.selectImage(initialIndex);
            this.typeTitle(); // Original call from loadData

        } catch (error) {
            console.warn("Metadata load failed, falling back to static list.", error);
            document.getElementById('loading-text').innerText = "Error loading gallery."; // Original error message
            this.useStaticFallback();
            // Re-init views with fallback data
            this.view3d.init(
                this.images,
                (index, openViewer) => this.selectImage(index, openViewer),
                (index) => this.preloadHighRes(index)
            );
            this.view2d.init(this.images, (index) => this.selectImage(index, true));
            this.switchMode(this.mode); // Initial State
            this.selectImage(0); // Select first image on fallback
            this.typeTitle();
        }
    }

    preloadAllThumbnails() {
        return new Promise((resolve) => {
            const total = this.images.length;
            const text = document.getElementById('loading-text');
            const bar = document.getElementById('loading-bar');

            // Stats Elements
            const elFile = document.getElementById('loading-file');
            const elData = document.getElementById('loading-data');
            const elSpeed = document.getElementById('loading-speed');

            if (total === 0) {
                resolve();
                return;
            }

            let loadedCount = 0;
            let totalBytes = 0;
            const startTime = Date.now();
            let activeDownloads = 0;

            const updateStats = (fileName = null) => {
                // Update Progress Bar
                const percent = Math.round((loadedCount / total) * 100);
                if (text) text.innerText = `Loading Gallery... ${loadedCount}/${total} (${percent}%)`;
                if (bar) bar.style.width = `${percent}%`;

                // Update File Name
                if (fileName && elFile) elFile.innerText = `Downloading: ${fileName}.jpg`;

                // Update Data & Speed
                if (elData) elData.innerText = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;

                const elapsed = (Date.now() - startTime) / 1000; // seconds
                if (elSpeed && elapsed > 0) {
                    const bps = totalBytes / elapsed;
                    // Format Speed
                    let speedStr = '';
                    if (bps > 1024 * 1024) speedStr = `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
                    else speedStr = `${(bps / 1024).toFixed(1)} KB/s`;
                    elSpeed.innerText = speedStr;
                }
            };

            const loadNext = async (imgName) => {
                try {
                    activeDownloads++;
                    updateStats(imgName);

                    const response = await fetch(`./thumbs/${imgName}.jpg`);
                    if (!response.ok) throw new Error('Network response was not ok');

                    const reader = response.body.getReader();

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value) {
                            totalBytes += value.length;
                            updateStats(); // Tick for speed updates
                        }
                    }

                    // Success
                    loadedCount++;
                } catch (err) {
                    console.warn("Failed to load thumb:", imgName, err);
                    loadedCount++; // Count as done to proceed
                } finally {
                    activeDownloads--;
                    updateStats();

                    if (loadedCount >= total) {
                        if (elFile) elFile.innerText = "Processing...";
                        setTimeout(resolve, 300);
                    }
                }
            };

            // Launch all (Browser limits concurrency automatically, usually 6)
            // Or we could batch? Simple loop is mostly fine for <50 items.
            // But for safety let's just loop.
            this.images.forEach(img => loadNext(img));
        });
    }

    preloadFullImages() {
        console.log("Starting background preload of full images...");
        const dir = this.useDataSaver ? 'thumbs' : 'fulls';
        if (dir === 'thumbs') return;

        // Low priority loading
        let loadedCount = 0;
        this.images.forEach((imgName, index) => {
            // Stagger requests to avoid freezing UI
            setTimeout(() => {
                const img = new Image();
                img.src = `./fulls/${imgName}.jpg`;
                img.onload = () => {
                    loadedCount++;
                    if (loadedCount === this.images.length) console.log("All full images preloaded.");
                };
            }, index * 200);
        });
    }

    useStaticFallback() {
        this.metadata = {};
        // Fallback list based on known files
        this.images = [
            "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
            "10", "11", "12", "13", "14", "15", "16", "17", "18", "19",
            "20", "21", "22", "23", "24"
        ];
    }

    initViews() {
        const onSelect = (index, openViewer) => this.selectImage(index, openViewer);
        this.view3d.init(this.images, onSelect);
        this.view2d.init(this.images, onSelect);

        // Initial State
        this.switchMode(this.mode);

        // Handle URL params
        const urlParams = new URLSearchParams(window.location.search);
        this.useDataSaver = urlParams.has('datasaver');

        if (urlParams.get('mode') === '2d' || urlParams.has('gallery')) {
            this.switchMode('2D');
        }

        // Initial Selection (Deep link)
        let initialIndex = 0;
        const targetImg = urlParams.get('img');
        if (targetImg) {
            const idx = this.images.indexOf(targetImg.replace('.jpg', '')); // assume param might be 'name' or 'name.jpg'
            if (idx !== -1) initialIndex = idx;
        }
        this.selectImage(initialIndex);
    }

    bindEvents() {
        if (this.ui.globalFullscreen) {
            this.ui.globalFullscreen.onclick = () => this.toggleNativeFullscreen();
        }

        this.ui.toggle.onclick = () => {
            const newMode = this.mode === '3D' ? '2D' : '3D';
            this.switchMode(newMode);
        };
        window.addEventListener('resize', () => {
            if (this.mode === '3D') this.view3d.resize();
        });

        // Navigation
        this.ui.leftArrow.onclick = () => this.prev();
        this.ui.rightArrow.onclick = () => this.next();

        // Map native wheel to zoom in 3D (prevent default scroll if in 3D)
        // Note: View3D handles the zoom logic, App just ensures it doesn't conflict
        // Added listener in View3D directly, so no change needed here except ensuring overlays don't block.


        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') this.prev();
            if (e.key === 'ArrowRight') this.next();
            if (e.key === 'Escape') this.closeFullscreen();
            if (e.key === 'Enter') this.enterFullscreen();
            if (e.key === 'i' || e.key === 'I') this.toggleMetadata();
            if (e.key === 't' || e.key === 'T') {
                const thumbs = document.getElementById('thumbnail-selector');
                if (thumbs) thumbs.classList.toggle('hidden');
            }
        });

        // Touch Swipe
        document.addEventListener('touchstart', (e) => {
            this.touchStartX = e.changedTouches[0].screenX;
        }, { passive: false });

        document.addEventListener('touchend', (e) => {
            this.touchEndX = e.changedTouches[0].screenX;
            this.handleSwipe();
        });

        // Metadata Toggles
        this.ui.toggleMetadata.onclick = () => this.toggleMetadata();

        // Viewer Controls
        this.ui.exitViewer.onclick = () => this.closeFullscreen();
        this.ui.fullscreenToggle.onclick = () => this.toggleNativeFullscreen();

        // Light Pollution Map
        this.ui.lightPollutionClose.onclick = () => this.hideLightPollutionMap();
    }

    handleSwipe() {
        // Only if not zoomed in viewer? For simplicity, global swipe for nav
        // But if we are in viewer and zoomed, we shouldn't nav. 
        // We'll leave zoom logic to specific viewer handlers later.
        if (Math.abs(this.touchStartX - this.touchEndX) > this.swipeThresh) {
            if (this.touchEndX < this.touchStartX) this.next();
            if (this.touchEndX > this.touchStartX) this.prev();
        }
    }

    switchMode(newMode) {
        // ALWAYS close fullscreen/viewer when switching modes.
        // This ensures:
        // 1. Image is deselected (Request 1)
        // 2. Transparent overlays are removed so buttons work again (Request 2)
        // 3. Top controls are re-enabled
        this.closeFullscreen();

        this.mode = newMode;
        this.ui.toggle.innerText = newMode === '3D' ? '2D' : '3D';

        if (newMode === '3D') {
            this.view2d.hide();
            this.view3d.show();
            this.view3d.resize(); // Ensure canvas size is correct

            // Arrows are managed by closeFullscreen (hidden by default), 
            // but for 3D globe we definitely want them hidden initially.
            this.ui.leftArrow.hidden = true;
            this.ui.rightArrow.hidden = true;
        } else {
            this.view3d.hide();
            this.view2d.show();
            // Don't scroll to current index. Let user start fresh or stay where they were.
            // this.view2d.goToIndex(this.currentIndex); 

            // Ensure arrows are hidden in grid view
            this.ui.leftArrow.hidden = true;
            this.ui.rightArrow.hidden = true;
        }
    }

    // Updated selectImage to calculate direction
    selectImage(index, openViewer = false, direction = 0) {
        console.log("App.selectImage", index, "openViewer:", openViewer);
        if (index < 0 || index >= this.images.length) return;

        // Infer direction if not explicitly given and we are close
        if (direction === 0 && this.currentIndex !== index) {
            direction = index > this.currentIndex ? 1 : -1;
            // Wrap-around logic? If jumping from last to first (future feature), handle here.
        }

        this.currentIndex = index;

        // Sync Views
        if (this.mode === '3D') this.view3d.goToIndex(index);
        else this.view2d.goToIndex(index);

        // Update Metadata
        this.updateMetadata(index);

        // If requested (by 2D click OR 3D active click), open fullscreen viewer
        // Note: Legacy viewer is a 2D overlay, so it works on top of canvas nicely.
        if (openViewer) {
            this.openFullscreenViewer(index, direction);
        } else if (!document.getElementById('imageViewer').hidden) {
            // If viewer is already open, update it
            this.openFullscreenViewer(index, direction);
        }

        // Preload neighbors
        this.preloadImages(index);
    }

    preloadImages(index) {
        const toPreload = [index + 1, index - 1];
        toPreload.forEach(i => {
            if (i >= 0 && i < this.images.length) {
                this.preloadHighRes(i);
            }
        });
    }

    preloadHighRes(index) {
        if (!this.images[index]) return;
        const imgName = this.images[index];
        const dir = this.useDataSaver ? 'thumbs' : 'fulls';
        const src = `./${dir}/${imgName}.jpg`;
        // Create link
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = src;
        document.head.appendChild(link);
        // Create Image object
        new Image().src = src;
    }

    next() {
        this.selectImage(this.currentIndex + 1, false, 1);
    }

    prev() {
        this.selectImage(this.currentIndex - 1, false, -1);
    }

    typeTitle() {
        const titleText = "📷 Gallery Template!!! 📷";
        let i = 0;
        this.ui.title.innerText = "";
        const interval = setInterval(() => {
            this.ui.title.innerText += titleText.charAt(i);
            i++;
            if (i > titleText.length) clearInterval(interval);
        }, 50);
    }

    // --- Metadata Logic ---
    updateMetadata(index) {
        if (!this.images[index]) return;
        const imgName = this.images[index];
        const data = this.metadata[imgName];

        let html = `<h2>${imgName}.jpg</h2>`;

        if (data) {
            // Formatting helpers
            const exifToDate = (ts) => {
                if (!ts) return 'N/A';
                const [d, t] = ts.split(' ');
                return new Date(d.replace(/:/g, '/') + ' ' + t);
            };
            const formatDate = (date) => {
                if (date === 'N/A') return 'N/A';
                if (!(date instanceof Date) || isNaN(date)) return 'N/A';
                const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' };
                return date.toLocaleDateString('en-US', options);
            };

            // GPS
            const convertDegrees = (valStr) => {
                const matches = valStr.match(/(\d+\s*\/\s*\d+|\d+(\.\d+)?)/g);
                if (!matches || matches.length < 3) return NaN;
                const parts = matches.map(s => {
                    if (s.includes('/')) {
                        const [n, d] = s.split('/').map(Number);
                        return n / d;
                    }
                    return Number(s);
                });
                return parts[0] + (parts[1] / 60) + (parts[2] / 3600);
            };

            const getGPS = (d) => {
                const lat = d['GPS GPSLatitude'], latRef = d['GPS GPSLatitudeRef'];
                const lon = d['GPS GPSLongitude'], lonRef = d['GPS GPSLongitudeRef'];
                if (lat && latRef && lon && lonRef) {
                    let layout = convertDegrees(lat);
                    if (latRef === 'S') layout *= -1;
                    let long = convertDegrees(lon);
                    if (lonRef === 'W') long *= -1;
                    if (!isNaN(layout) && !isNaN(long)) return { lat: layout.toFixed(4), lon: long.toFixed(4) };
                }
                return null;
            };

            const captureDate = exifToDate(data['Image DateTime']);
            const gps = getGPS(data);
            const w = data['Image Width'] || 'N/A';
            const h = data['Image Height'] || 'N/A';
            const res = (w !== 'N/A' && h !== 'N/A') ? (w * h / 1000000).toFixed(1) : 'N/A';
            const size = data['File Size'] ? (data['File Size'] / (1000 * 1000)).toFixed(2) : 'N/A';
            const model = data['Image Model'] || 'N/A';

            // Eval for rational numbers like "1/50"
            const safeEval = (s) => { try { return eval(s); } catch { return s; } };
            const iso = data['EXIF ISOSpeedRatings'] ? safeEval(data['EXIF ISOSpeedRatings']) : 'N/A';
            const f = data['EXIF FNumber'] ? safeEval(data['EXIF FNumber']) : 'N/A';
            const expRaw = data['EXIF ExposureTime'] ? safeEval(data['EXIF ExposureTime']) : 'N/A';
            const exp = (typeof expRaw === 'number' && expRaw < 0.1 && expRaw > 0) ? `1/${Math.round(1 / expRaw)}` : expRaw;

            html += `<p>🗓️: ${formatDate(captureDate)}</p>`;
            if (gps) {
                // We add a data attribute or global function click handler wrapper
                window.showMap = (lat, lon) => this.showLightPollutionMap(lat, lon);
                html += `<p>📍: <span style="text-decoration: underline; cursor: pointer;" onclick="window.showMap(${gps.lat}, ${gps.lon})">${gps.lat}, ${gps.lon}</span></p>`;
            } else {
                html += `<p>📍: N/A</p>`;
            }
            html += `<p>📷: ${model}</p>`;
            html += `<p>${size} MB | ${w}x${h} | ${res} MP</p>`;
            html += `<p>ISO ${iso} | F${f} | ${exp}" s</p>`;

        } else {
            html += `<p>No metadata available.</p>`;
        }

        this.ui.metadataViewer.innerHTML = html;
    }

    toggleMetadata() {
        this.ui.metadataViewer.classList.toggle('visible');
    }

    // --- Viewer Logic ---
    openFullscreenViewer(index, direction = 0) {
        console.log("Opening Viewer for", index, "Dir:", direction);
        const imgName = this.images[index];
        const dir = this.useDataSaver ? 'thumbs' : 'fulls';

        // 1. Manage Metadata Button
        if (this.ui.toggleMetadata) {
            this.ui.toggleMetadata.classList.remove('hidden');
            this.ui.toggleMetadata.style.display = 'block';
            this.ui.toggleMetadata.onclick = (e) => {
                e.stopPropagation();
                this.toggleMetadata();
            };
        }

        // Hide Global Top Controls to prevent overlap
        if (this.ui.topControls) this.ui.topControls.style.opacity = '0';
        if (this.ui.topControls) this.ui.topControls.style.pointerEvents = 'none';

        // Hide Title to prevent overlap on mobile (and cleaner look generally)
        if (this.ui.title) this.ui.title.style.opacity = '0';

        const container = this.ui.fullImageContainer;

        // --- 3D MODE: SPECIAL CAROUSEL VIEW ---
        if (this.mode === '3D') {
            // We do NOT create a DOM image. We use the 3D scene.
            // Ensure container is empty (remove any leftover 2D images)
            container.innerHTML = '';

            // Trigger 3D Transition
            this.view3d.enterLineView(index);

            // Show UI Overlays (Metadata, Controls)
            this.updateMetadata(index);
            this.ui.imageViewer.hidden = false;
            this.ui.imageViewer.classList.add('visible');
            this.ui.imageViewer.classList.add('transparent'); // IMPORTANT: No black bg

            // Show Arrows (They were hidden in Globe mode)
            this.ui.leftArrow.hidden = false;
            this.ui.rightArrow.hidden = false;

            // Update Thumb Palette
            if (!this.thumbnailsCreated) {
                this.createThumbSelector();
                this.thumbnailsCreated = true;
            }
            this.updateThumbSelector(index);
            return;
        }

        // --- 2D MODE: STANDARD DOM VIEWER ---
        this.ui.imageViewer.classList.remove('transparent'); // Ensure black bg for 2D

        // Show Arrows for navigation
        this.ui.leftArrow.hidden = false;
        this.ui.rightArrow.hidden = false;

        // --- PREPARE OLD IMAGE FOR EXIT ---
        const oldImg = container.querySelector('img.active');
        if (oldImg) {
            oldImg.classList.remove('active');
            oldImg.style.zIndex = '0'; // Move behind

            // Slide Animation Logic
            if (direction !== 0) {
                // If moving NEXT (dir=1), old image slides LEFT (-100%)
                // If moving PREV (dir=-1), old image slides RIGHT (100%)
                const exitX = direction > 0 ? '-100%' : '100%';
                oldImg.style.transition = 'transform 0.4s ease-in-out, opacity 0.4s ease';
                oldImg.style.transform = `translate(${exitX}, 0)`;
                oldImg.style.opacity = '0.5';
            } else {
                // Initial open or jump: Fade out
                oldImg.style.opacity = 0;
            }

            setTimeout(() => { if (oldImg.parentElement) oldImg.remove(); }, 500);
        }

        // --- Zoom / Pan Variables ---
        // Resets freshly for the new image
        let zoomLevel = 1;
        let pannedX = 0;
        let pannedY = 0;
        let isDragging = false;
        let startX = 0;
        let startY = 0;

        // Create New Image
        const newImg = document.createElement('img');
        newImg.style.opacity = '0';
        newImg.style.position = 'absolute';
        newImg.style.maxWidth = '95%';
        newImg.style.maxHeight = '95%';
        newImg.style.objectFit = 'contain';
        newImg.style.transformOrigin = 'center center';
        newImg.style.zIndex = '10'; // Above old image
        newImg.src = `./fulls/${imgName}.jpg`;
        newImg.className = 'active';

        // Initial Position for Slide
        if (direction !== 0) {
            // If moving NEXT (dir=1), new comes from RIGHT (100%)
            // If moving PREV (dir=-1), new comes from LEFT (-100%)
            const enterX = direction > 0 ? '100%' : '-100%';
            newImg.style.transform = `translate(${enterX}, 0) scale(1)`;
            // Wait for mount to transition to 0
        } else {
            // Center default
            newImg.style.transform = 'translate(0, 0) scale(1)';
        }

        // Transition settings:
        // We need explicit transition for the slide (transform) and fade (opacity)
        newImg.style.transition = 'transform 0.4s ease-out, opacity 0.4s ease';

        // Helper to update transform during Zoom/Pan
        const updateTransform = () => {
            // When panning, we want INSTANT response, so we might disable transition temporarily in events
            newImg.style.transform = `translate(${pannedX}px, ${pannedY}px) scale(${zoomLevel})`;

            if (zoomLevel > 1) {
                newImg.style.cursor = 'grab';
            } else {
                newImg.style.cursor = 'default';
                pannedX = 0;
                pannedY = 0;
            }
        };

        // Event Listeners
        container.onwheel = (e) => {
            e.preventDefault();
            const delta = -Math.sign(e.deltaY) * 0.25;
            const nextZoom = Math.min(Math.max(1, zoomLevel + delta), 4);
            if (nextZoom !== zoomLevel) {
                zoomLevel = nextZoom;
                if (zoomLevel === 1) { pannedX = 0; pannedY = 0; }
                newImg.style.transition = 'transform 0.1s linear'; // Smooth zoom
                updateTransform();
            }
        };

        container.ondblclick = (e) => {
            if (zoomLevel > 1) zoomLevel = 1;
            else zoomLevel = 2.5;
            pannedX = 0;
            pannedY = 0;
            newImg.style.transition = 'transform 0.3s ease-in-out';
            updateTransform();
        };

        container.onpointerdown = (e) => {
            if (zoomLevel <= 1) return;
            isDragging = true;
            startX = e.clientX - pannedX;
            startY = e.clientY - pannedY;
            newImg.style.cursor = 'grabbing';
            newImg.style.transition = 'none'; // IMPORTANT: Instant drag
            container.setPointerCapture(e.pointerId);
            e.preventDefault(); // Stop default touch actions
        };

        container.onpointermove = (e) => {
            if (!isDragging) return;
            e.preventDefault();
            pannedX = e.clientX - startX;
            pannedY = e.clientY - startY;
            // No transition call here needed as we set it to none on down
            // But just to be safe/explicit:
            newImg.style.transform = `translate(${pannedX}px, ${pannedY}px) scale(${zoomLevel})`;
        };

        container.onpointerup = (e) => {
            if (!isDragging) return;
            isDragging = false;
            newImg.style.cursor = 'grab';
            newImg.style.transition = 'transform 0.1s linear'; // Restore smooth
            container.releasePointerCapture(e.pointerId);
        };

        // Ensure touch-action is none to allow pure JS handling
        container.style.touchAction = 'none';

        // Loader
        let loader = null;
        const loaderTimeout = setTimeout(() => {
            loader = document.createElement('div');
            loader.className = 'loader';
            container.appendChild(loader);
        }, 500);

        newImg.onload = () => {
            clearTimeout(loaderTimeout);

            // Trigger Entry Animation
            requestAnimationFrame(() => {
                newImg.style.opacity = '1';
                newImg.style.transform = 'translate(0, 0) scale(1)';
            });

            if (loader && loader.parentNode) loader.parentNode.removeChild(loader);

            // Update Palette UI
            if (!this.thumbnailsCreated) {
                this.createThumbSelector();
                this.thumbnailsCreated = true;
            }
            this.updateThumbSelector(index);
        };

        newImg.onerror = () => {
            clearTimeout(loaderTimeout);
            if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
        };

        container.appendChild(newImg);

        // Update Metadata
        this.updateMetadata(index);
        this.ui.imageViewer.hidden = false;

        // Fade In Viewer
        requestAnimationFrame(() => {
            this.ui.imageViewer.classList.add('visible');
        });
    }

    createThumbSelector() {
        const container = document.getElementById('thumbnail-selector');
        container.innerHTML = '';
        this.images.forEach((imgName, i) => {
            const img = document.createElement('img');
            img.src = `./thumbs/${imgName}.jpg`;
            img.className = 'thumb-small';
            img.dataset.index = i;
            img.onclick = (e) => {
                e.stopPropagation();
                this.selectImage(i, true);
            };
            container.appendChild(img);
        });

        // Bind Toggle Button
        document.getElementById('toggleThumbs').onclick = (e) => {
            e.stopPropagation();
            container.classList.toggle('hidden');
        };
    }

    updateThumbSelector(index) {
        const container = document.getElementById('thumbnail-selector');
        const thumbs = container.querySelectorAll('.thumb-small');
        thumbs.forEach(t => t.classList.remove('active'));
        if (thumbs[index]) {
            thumbs[index].classList.add('active');
            thumbs[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    closeFullscreen() {
        this.ui.imageViewer.classList.remove('visible');
        this.ui.imageViewer.classList.remove('transparent'); // Ensure we strip this immediately

        setTimeout(() => {
            this.ui.imageViewer.hidden = true;
            this.ui.fullImageContainer.innerHTML = '';

            // If in 3D mode, exit Line View and re-hide arrows
            if (this.mode === '3D') {
                this.view3d.exitLineView();
                this.ui.leftArrow.hidden = true;
                this.ui.rightArrow.hidden = true;
            } else {
                // In 2D Mode, closing means deselecting
                this.view2d.goToIndex(-1); // Clear grid highlight
                this.ui.metadataViewer.classList.remove('visible'); // Hide metadata overlay

                // Hide Arrows (return to Grid)
                this.ui.leftArrow.hidden = true;
                this.ui.rightArrow.hidden = true;
            }
        }, 300);

        // Restore Global Top Controls
        // Ensure we force these back to interactive state
        if (this.ui.topControls) {
            this.ui.topControls.style.opacity = '1';
            this.ui.topControls.style.pointerEvents = 'auto';
            this.ui.topControls.style.visibility = 'visible'; // JIC
        }

        // Restore Title
        if (this.ui.title) this.ui.title.style.opacity = '0.9'; // Default opacity
    }

    toggleNativeFullscreen() {
        const doc = window.document;
        const docEl = doc.documentElement;

        // Standard
        const requestFullScreen = docEl.requestFullscreen || docEl.mozRequestFullScreen || docEl.webkitRequestFullScreen || docEl.msRequestFullscreen;
        const cancelFullScreen = doc.exitFullscreen || doc.mozCancelFullScreen || doc.webkitExitFullscreen || doc.msExitFullscreen;

        if (!doc.fullscreenElement && !doc.mozFullScreenElement && !doc.webkitFullscreenElement && !doc.msFullscreenElement) {
            requestFullScreen.call(docEl);
        } else {
            cancelFullScreen.call(doc);
        }
    }

    updateFullscreenButtonState() {
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
        const icon = isFullscreen ? '✖️' : '⛶'; // Use X for exit, or resize icon
        // Or better: Use "Compress" icon for exit: ↙️ or similar. Let's stick to simple change or just keeping it static if ambiguous.
        // Actually, let's keep it static '⛶' for now as '✖️' might be confused with "Close Viewer".
        // Instead, just ensure the functionality works.
        // If user specifically asked "Make sure it works", robustness is key.
    }

    // --- Light Pollution Map ---
    showLightPollutionMap(lat, lon) {
        const url = `https://timothydo.me/astronomy/lightpollution/?lat=${lat}&lon=${lon}`;
        this.ui.lightPollutionIframe.src = url;
        this.ui.lightPollutionOverlay.classList.add('visible');
    }

    hideLightPollutionMap() {
        this.ui.lightPollutionOverlay.classList.remove('visible');
        this.ui.lightPollutionIframe.src = 'about:blank';
    }

    enterFullscreen() {
        if (this.mode === '2D') {
            this.selectImage(this.currentIndex, true);
        } else {
            this.toggleMetadata();
        }
    }
}

// Start App
window.onload = () => {
    window.galleryApp = new App();
};
