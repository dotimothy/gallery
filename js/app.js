
import { View3D } from './view3d.js';
import { View2D } from './view2d.js';
import { SettingsManager } from './settings.js';
import { ViewStateManager } from './ViewStateManager.js';
import { TouchManager } from './TouchManager.js';

class App {
    constructor() {
        this.mode = '3D'; // Start in 3D
        this.currentIndex = 0;
        this.images = [];
        this.metadata = {};
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1);

        // Debug Flag
        this.isDebug = new URLSearchParams(window.location.search).has('debug');

        // Touch State
        this.touchStartX = 0;
        this.touchEndX = 0;
        this.swipeThresh = 75;

        // Slideshow State
        this.isSlideshowActive = false;
        this.slideshowInterval = 3000;
        this.slideshowTimer = null;
        this.viewerCloseTimer = null; // Prevent race conditions

        // Elements
        this.ui = {
            title: document.getElementById('title'),
            toggle: document.getElementById('mode-toggle'),
            topControls: document.getElementById('top-controls'), // Added
            viewerSlideshow: document.getElementById('viewer-slideshow'), // Added
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
        // this.view3d.init() is called in loadData after we have images

        this.view2d = new View2D(document.getElementById('gallery-2d'));
        // this.view2d.init() is called in loadData

        // Settings System
        this.settings = new SettingsManager((key, value) => this.applySetting(key, value), this.isMobile);
        // Apply initial settings
        this.applyAllSettings();

        // State Management System
        this.viewState = new ViewStateManager();
        this.setupStateHooks();

        this.bindEvents();
        this.loadData();
    }

    log(msg, ...args) {
        if (this.isDebug) {
            console.log(`[App] ${msg}`, ...args);
        }
    }

    setupStateHooks() {
        // EXPLORE -> PREVIEW: Open image viewer
        this.viewState.registerHook('preview', 'onEnter', (fromState) => {
            this.log('Entering PREVIEW state');
            this.ui.imageViewer.hidden = false;
            this.ui.imageViewer.classList.add('visible');

            // Pause 3D rendering to save battery
            if (this.mode === '3D') {
                this.view3d.pauseRendering();
            }
        });

        // PREVIEW -> DETAIL: Enter magnifier
        this.viewState.registerHook('detail', 'onEnter', (fromState) => {
            this.log('Entering DETAIL state');
            this.ui.imageViewer.classList.remove('transparent');
            this.ui.fullImageContainer.style.display = 'flex';

            // Completely hide 3D canvas to prevent event leakage
            if (this.mode === '3D') {
                document.getElementById('gallery-3d').style.display = 'none';
            }

            // Update zoom button
            const zoomBtn = document.getElementById('zoomBtn');
            if (zoomBtn) {
                zoomBtn.innerText = '🔙';
                zoomBtn.title = 'Return to Preview';
            }

            // Hide arrows in magnifier
            this.ui.leftArrow.hidden = true;
            this.ui.rightArrow.hidden = true;
        });

        // DETAIL -> PREVIEW: Exit magnifier
        this.viewState.registerHook('preview', 'onEnter', (fromState) => {
            if (fromState === 'detail') {
                this.log('Exiting DETAIL to PREVIEW');
                this.ui.fullImageContainer.style.display = 'none';

                // Restore 3D canvas
                if (this.mode === '3D') {
                    document.getElementById('gallery-3d').style.display = 'block';
                    this.ui.imageViewer.classList.add('transparent');
                }

                // Update zoom button
                const zoomBtn = document.getElementById('zoomBtn');
                if (zoomBtn) {
                    zoomBtn.innerText = '🔍';
                    zoomBtn.title = 'Zoom / Magnify';
                }

                // Restore arrows if not in slideshow
                if (!this.isSlideshowActive) {
                    this.ui.leftArrow.hidden = false;
                    this.ui.rightArrow.hidden = false;
                }
            }
        });

        // PREVIEW -> EXPLORE: Close viewer
        this.viewState.registerHook('explore', 'onEnter', (fromState) => {
            this.log('Entering EXPLORE state');
            this.ui.imageViewer.classList.remove('visible');
            this.ui.imageViewer.classList.remove('transparent');

            setTimeout(() => {
                this.ui.imageViewer.hidden = true;
                this.ui.fullImageContainer.innerHTML = '';
                this.ui.fullImageContainer.style.display = 'none';
            }, 300);

            // Resume 3D rendering
            if (this.mode === '3D') {
                document.getElementById('gallery-3d').style.display = 'block';
                this.view3d.resumeRendering();
                this.view3d.exitLineView();
            }

            // Hide arrows
            this.ui.leftArrow.hidden = true;
            this.ui.rightArrow.hidden = true;
        });
    }

    handleURLParams() {
        const urlParams = new URLSearchParams(window.location.search);
        this.useDataSaver = urlParams.has('datasaver');

        // Mode
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

        // Slideshow Params
        if (urlParams.has('interval')) {
            const interval = parseInt(urlParams.get('interval'));
            if (!isNaN(interval) && interval > 500) {
                this.settings.set('slideshowInterval', interval / 1000);
            }
        }
        if (urlParams.has('slideshow')) {
            this.startSlideshow();
        }
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

            this.log(`Loaded metadata with ${this.images.length} images.`);

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
                (index, openViewer) => this.selectImage(index, openViewer),
                (index) => this.preloadHighRes(index),
                this.isMobile,
                this.isDebug,
                () => { if (!this.isSlideshowActive) this.toggleMagnifier(); } // Auto-Magnify Callback
            );

            // 7. Init 2D View
            this.view2d.init(this.images, (index) => this.selectImage(index, true)); // Original selectImage

            // 8. Apply initial state and URL params
            this.switchMode(this.mode); // Reset to default first
            this.handleURLParams();
            this.typeTitle();

        } catch (error) {
            if (this.isDebug) console.warn("Metadata load failed, falling back to static list.", error);
            document.getElementById('loading-text').innerText = "Error loading gallery."; // Original error message
            this.useStaticFallback();
            // Re-init views with fallback data
            this.view3d.init(
                this.images,
                (index, openViewer) => this.selectImage(index, openViewer),
                (index) => this.preloadHighRes(index),
                this.isMobile,
                this.isDebug,
                () => { if (!this.isSlideshowActive) this.toggleMagnifier(); }
            );
            this.view2d.init(this.images, (index) => this.selectImage(index, true), this.isDebug);

            this.switchMode(this.mode); // Initial State
            this.handleURLParams();
            this.typeTitle();
        }
    }

    applySetting(key, value) {
        // Update view logic
        if (key === 'resolution' || key === 'sphereSpacing' || key === 'particleCount') {
            this.view3d.updateSettings(key, value);
        }
        if (key === 'gridColumns') {
            this.view2d.updateSettings(key, value);
        }
        if (key === 'slideshowInterval') {
            this.slideshowInterval = value * 1000; // Store as ms
            // Restart if running
            if (this.isSlideshowActive) {
                this.stopSlideshow();
                this.startSlideshow();
            }
        }

        // Update display values in settings modal
        const displayMap = {
            'resolution': { id: 'disp-resolution', suffix: 'x' },
            'sphereSpacing': { id: 'disp-sphere', suffix: '' },
            'particleCount': { id: 'disp-particles', suffix: '' },
            'gridColumns': { id: 'disp-grid', suffix: '' },
            'slideshowInterval': { id: 'disp-interval', suffix: 's' }
        };

        if (displayMap[key]) {
            const display = document.getElementById(displayMap[key].id);
            if (display) {
                display.innerText = value + displayMap[key].suffix;
            }
        }
    }

    applyAllSettings() {
        // Sync all settings from manager to views
        const keys = ['resolution', 'sphereSpacing', 'particleCount', 'gridColumns', 'slideshowInterval'];
        keys.forEach(k => this.applySetting(k, this.settings.get(k)));
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
                    if (this.isDebug) console.warn("Failed to load thumb:", imgName, err);
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
        this.log("Starting background preload of full images...");
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
                    if (loadedCount === this.images.length) this.log("All full images preloaded.");
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



    bindEvents() {
        if (this.ui.globalFullscreen) {
            this.ui.globalFullscreen.onclick = () => this.toggleNativeFullscreen();
        }

        // Slideshow Toggle
        if (this.ui.btnSlideshow) {
            this.ui.btnSlideshow.onclick = () => this.toggleSlideshow();
        }
        if (this.ui.viewerSlideshow) {
            this.ui.viewerSlideshow.onclick = (e) => {
                e.stopPropagation();
                this.toggleSlideshow();
            };
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
            if (e.key === 'Escape') {
                // If in 3D and Magnifier is active (viewer not transparent), exit Magnifier first
                if (this.mode === '3D' && !this.ui.imageViewer.classList.contains('transparent')) {
                    this.toggleMagnifier();
                } else {
                    this.closeFullscreen();
                }
            }
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
        const zoomBtn = document.getElementById('zoomBtn');
        if (zoomBtn) {
            zoomBtn.onclick = (e) => {
                e.stopPropagation(); // Prevent propagation
                this.log("Zoom Btn Clicked");
                this.toggleMagnifier();
            };
        } else {
            console.error("Zoom Btn not found in DOM");
        }

        // Light Pollution Map
        this.ui.lightPollutionClose.onclick = () => this.hideLightPollutionMap();

        // --- Settings UI Events ---
        const settingsModal = document.getElementById('settingsModal');
        const openSettings = document.getElementById('toggleSettings');
        const closeSettings = document.getElementById('closeSettings');
        const resetSettings = document.getElementById('resetSettings');

        if (openSettings) {
            openSettings.onclick = () => {
                settingsModal.classList.remove('hidden');
                setTimeout(() => settingsModal.classList.add('visible'), 10);

                // Toggle Groups based on Mode
                const group3d = document.getElementById('group-3d');
                const group2d = document.getElementById('group-2d');
                if (group3d) group3d.style.display = (this.mode === '3D') ? 'block' : 'none';
                if (group2d) group2d.style.display = (this.mode === '2D') ? 'block' : 'none';

                // Sync sliders to current values
                document.getElementById('set-resolution').value = this.settings.get('resolution');
                document.getElementById('set-sphere').value = this.settings.get('sphereSpacing');
                document.getElementById('set-particles').value = this.settings.get('particleCount');
                document.getElementById('set-grid').value = this.settings.get('gridColumns');
                document.getElementById('set-interval').value = this.settings.get('slideshowInterval');
            };
        }

        if (closeSettings) {
            closeSettings.onclick = () => {
                settingsModal.classList.remove('visible');
                setTimeout(() => settingsModal.classList.add('hidden'), 300);
            };
        }

        // Inputs
        const bindInput = (id, key, isFloat = false) => {
            const el = document.getElementById(id);
            if (el) {
                el.oninput = (e) => {
                    const val = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value);
                    this.settings.set(key, val);
                };
            }
        };

        bindInput('set-resolution', 'resolution', true);
        bindInput('set-sphere', 'sphereSpacing', true);
        bindInput('set-particles', 'particleCount', false);
        bindInput('set-grid', 'gridColumns', false);
        bindInput('set-interval', 'slideshowInterval', true);

        if (resetSettings) {
            resetSettings.onclick = () => {
                this.settings.reset();
                // Update slider UI
                document.getElementById('set-resolution').value = this.settings.get('resolution');
                document.getElementById('set-sphere').value = this.settings.get('sphereSpacing');
                document.getElementById('set-particles').value = this.settings.get('particleCount');
                document.getElementById('set-grid').value = this.settings.get('gridColumns');
                document.getElementById('set-interval').value = this.settings.get('slideshowInterval');
            };
        }
    }

    handleSwipe() {
        // 1. ONLY navigate if the viewer is open. 
        // If hidden, we are probably rotating the 3D sphere or browsing the 2D grid.
        if (this.ui.imageViewer.hidden) return;

        // 2. Block navigation ONLY if specifically zoomed in (panning)
        // This allows swiping between images even in Magnifier mode if at 1x zoom.
        if (this.ui.fullImageContainer.isZoomed && this.ui.fullImageContainer.isZoomed()) return;

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
        this.log(`selectImage Idx:${index} Open:${openViewer}`);
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

        // Check visibility
        const isViewerVisible = !this.ui.imageViewer.hidden;
        this.log(`selectImage: ViewerVisible? ${isViewerVisible} ReqOpen? ${openViewer}`);

        // If requested (by 2D click OR 3D active click), open fullscreen viewer
        // Note: Legacy viewer is a 2D overlay, so it works on top of canvas nicely.
        if (openViewer || isViewerVisible) {
            this.log("Calling openFullscreenViewer...");
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

    next(openViewer = false) {
        let nextIndex = this.currentIndex + 1;
        if (nextIndex >= this.images.length) nextIndex = 0; // Loop to start
        this.selectImage(nextIndex, openViewer, 1);
    }

    prev() {
        let prevIndex = this.currentIndex - 1;
        if (prevIndex < 0) prevIndex = this.images.length - 1; // Loop to end
        this.selectImage(prevIndex, false, -1);
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

    // --- Slideshow Logic ---
    toggleSlideshow() {
        if (this.isSlideshowActive) {
            this.stopSlideshow();
        } else {
            this.startSlideshow();
        }
    }

    startSlideshow() {
        if (this.isSlideshowActive) return;
        this.isSlideshowActive = true;
        this.log(`Starting slideshow. Interval: ${this.slideshowInterval}ms`);


        if (this.ui.viewerSlideshow) {
            this.ui.viewerSlideshow.innerText = '⏸️';
            this.ui.viewerSlideshow.title = "Stop Slideshow";
        }

        // Feature: Slideshow "goes into image viewer"
        // Ensure viewer is open AND update state (hide arrows, zoom 3D)
        this.selectImage(this.currentIndex, true);

        this.slideshowTimer = setInterval(() => {
            // Keep viewer open if slideshow is running
            this.next(true);
        }, this.slideshowInterval);
    }

    stopSlideshow() {
        if (!this.isSlideshowActive) return;
        this.isSlideshowActive = false;
        this.log("Stopping slideshow.");

        if (this.slideshowTimer) {
            clearInterval(this.slideshowTimer);
            this.slideshowTimer = null;
        }


        if (this.ui.viewerSlideshow) {
            this.ui.viewerSlideshow.innerText = '▶️';
            this.ui.viewerSlideshow.title = "Start Slideshow";
        }

        // Restore UI state (Arrows, standard zoom)
        this.selectImage(this.currentIndex, true);
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
        // Cancel any pending close animation to prevent race conditions
        if (this.viewerCloseTimer) {
            clearTimeout(this.viewerCloseTimer);
            this.viewerCloseTimer = null;
        }

        this.log(`Opening Viewer for Idx:${index} Dir:${direction}`);

        // Transition to PREVIEW state
        if (this.viewState.getState() === 'explore') {
            this.viewState.transition('preview');
        }

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

            // Show Arrows (Only if not slideshow)
            if (!this.isSlideshowActive) {
                this.ui.leftArrow.hidden = false;
                this.ui.rightArrow.hidden = false;
            } else {
                this.ui.leftArrow.hidden = true;
                this.ui.rightArrow.hidden = true;
            }

            // RESET UI STATE (Fix for navigation from Magnified state)
            const zoomBtn = document.getElementById('zoomBtn');
            if (zoomBtn) {
                zoomBtn.innerText = '🔍';
                zoomBtn.title = 'Zoom / Magnify';
            }
            if (zoomBtn) {
                zoomBtn.innerText = '🔍';
                zoomBtn.title = 'Zoom / Magnify';
            }
            // Use existing state for thumbs
            // if (thumbs) thumbs.classList.remove('hidden');

            // Update Thumb Palette
            if (!this.thumbnailsCreated) {
                this.createThumbSelector();
                this.thumbnailsCreated = true;
            }
            this.updateThumbSelector(index);

            // Toggle Thumbs visibility for slideshow at default
            // Toggle Thumbs visibility for slideshow at default
            const thumbs = document.getElementById('thumbnail-selector');
            if (thumbs) {
                if (this.isSlideshowActive) thumbs.classList.add('hidden');
            }
            return;
            return;
        }

        // --- 2D MODE: STANDARD DOM VIEWER ---
        this.ui.imageViewer.hidden = false; // Fixed: Ensure hidden is removed so selectImage tracks visibility
        this.ui.imageViewer.classList.remove('transparent'); // Ensure black bg for 2D

        // Show Arrows for navigation (Only if not slideshow)
        if (!this.isSlideshowActive) {
            this.ui.leftArrow.hidden = false;
            this.ui.rightArrow.hidden = false;
        } else {
            this.ui.leftArrow.hidden = true;
            this.ui.rightArrow.hidden = true;
        }

        this.mountActiveImage(index, direction);

        // Show Arrows for navigation
        if (!this.isSlideshowActive) {
            this.ui.leftArrow.hidden = false;
            this.ui.rightArrow.hidden = false;
        }

        // Toggle Thumbs visibility for slideshow
        // Toggle Thumbs visibility for slideshow
        const thumbs = document.getElementById('thumbnail-selector');
        if (thumbs) {
            if (this.isSlideshowActive) thumbs.classList.add('hidden');
        }

        // Fade In Viewer
        requestAnimationFrame(() => {
            this.ui.imageViewer.classList.add('visible');
        });
    }

    mountActiveImage(index, direction = 0) {
        this.log(`mountActiveImage called for Idx:${index}`);
        const imgName = this.images[index];
        const container = this.ui.fullImageContainer;

        // RESET UI STATE (Fix for navigation while zoomed)
        const zoomBtn = document.getElementById('zoomBtn');
        if (zoomBtn) {
            zoomBtn.innerText = '🔍';
            zoomBtn.title = 'Zoom / Magnify';
        }
        const thumbs = document.getElementById('thumbnail-selector');
        // if (thumbs) thumbs.classList.remove('hidden');

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

        // Exposed Toggle Function for External Control (Magnifier Button)
        container.toggleZoom = () => {
            let isZoomed = false;
            if (zoomLevel > 1) {
                zoomLevel = 1;
                isZoomed = false;
            } else {
                zoomLevel = 3.0; // Max zoom for magnifier
                isZoomed = true;
            }
            pannedX = 0;
            pannedY = 0;
            // Ensure transition is active for the zoom
            newImg.style.transition = 'transform 0.3s ease-in-out';
            updateTransform();
            return isZoomed;
        };

        // Expose state helper
        container.isZoomed = () => zoomLevel > 1;

        // Event Listeners
        container.onwheel = (e) => {
            e.preventDefault();
            const delta = -Math.sign(e.deltaY) * 0.25;
            const nextZoom = Math.min(Math.max(1, zoomLevel + delta), 4);

            // Auto-Exit Logic (User requested: "zoom out to exit magnifier")
            // If we are at 1x and try to zoom out (delta < 0, scroll down)
            if (this.mode === '3D' && zoomLevel <= 1 && delta < 0) {
                this.toggleMagnifier();
                return;
            }

            if (nextZoom !== zoomLevel) {
                zoomLevel = nextZoom;
                if (zoomLevel === 1) { pannedX = 0; pannedY = 0; }
                newImg.style.transition = 'transform 0.1s linear'; // Smooth zoom
                updateTransform();
            }
        };

        // Single Click to Toggle Zoom (Enhanced UX for mobile/touch)
        // User requested: "don't have to double tap to enable tap and zoom"
        container.onclick = (e) => {
            // If we are already zoomed, we want dragging to work, but a quick tap resets?
            // Actually, if they are zoomed, dragging is handled by pointerdown/move.
            // If they just CLICK (down then up without much move), toggle zoom.
            if (zoomLevel > 1) {
                // Return to 1x
                zoomLevel = 1;
                pannedX = 0;
                pannedY = 0;
            } else {
                // Zoom to 3x center
                zoomLevel = 3.0;
                pannedX = 0;
                pannedY = 0;
            }
            newImg.style.transition = 'transform 0.3s ease-in-out';
            updateTransform();

            // Sync Toggle Zoom Button UI
            const zoomBtn = document.getElementById('zoomBtn');
            if (zoomBtn) {
                if (zoomLevel > 1) {
                    zoomBtn.innerText = '🔙';
                    zoomBtn.title = "Reset Zoom";
                } else {
                    zoomBtn.innerText = '🔍';
                    zoomBtn.title = "Zoom / Magnify";
                }
            }
        };

        container.ondblclick = (e) => {
            // Already handled by single click now for faster mobile access
        };

        container.onpointerdown = (e) => {
            if (zoomLevel <= 1) return;
            isDragging = true;
            startX = e.clientX - pannedX;
            startY = e.clientY - pannedY;
            newImg.style.cursor = 'grabbing';
            newImg.style.transition = 'none'; // IMPORTANT: Instant drag
            container.setPointerCapture(e.pointerId);
        };

        // === TOUCH MANAGER INTEGRATION ===
        const touchManager = new TouchManager(container);

        let lastIncX = 0;
        let lastIncY = 0;
        let panInertia = null;

        // Configure hysteresis for smooth transitions
        touchManager.setHysteresis(1.15, 1.03);

        // Register Pinch Gesture: Handle zoom with state transitions
        touchManager.registerGesture('onPinch', (scale, thresholds) => {
            const currentState = this.viewState.getState();

            if (panInertia) { panInertia.kill(); panInertia = null; }

            // State-based pinch handling
            if (this.mode === '3D') {
                if (currentState === 'preview' && scale > thresholds.enterThreshold) {
                    this.viewState.transition('detail');
                } else if (currentState === 'detail' && scale < thresholds.exitThreshold) {
                    this.viewState.transition('preview');
                }
            }

            // Apply zoom transform
            if (currentState === 'detail' || this.mode === '2D') {
                const scaleFactor = (scale - 1) * 0.5;
                const nextZoom = Math.min(Math.max(1, zoomLevel + scaleFactor), 4);

                if (nextZoom !== zoomLevel) {
                    zoomLevel = nextZoom;
                    if (zoomLevel === 1) { pannedX = 0; pannedY = 0; }
                    newImg.style.transition = 'none';
                    updateTransform();
                }
            }
        });

        // Register Pan Gesture: Move zoomed image with momentum
        touchManager.registerGesture('onPan', (incX, incY, state) => {
            if (zoomLevel <= 1) return;

            if (state === 'start') {
                if (panInertia) { panInertia.kill(); panInertia = null; }
                newImg.style.transition = 'none';
            } else if (state === 'move') {
                pannedX += incX;
                pannedY += incY;
                lastIncX = incX;
                lastIncY = incY;
                updateTransform();
            } else if (state === 'end') {
                // Momentum Panning using GSAP
                const velocityX = lastIncX * 10;
                const velocityY = lastIncY * 10;

                panInertia = gsap.to({ x: pannedX, y: pannedY }, {
                    x: pannedX + velocityX,
                    y: pannedY + velocityY,
                    duration: 0.8,
                    ease: "power2.out",
                    onUpdate: function () {
                        pannedX = this.targets()[0].x;
                        pannedY = this.targets()[0].y;
                        updateTransform();
                    }
                });
            }
        });

        // Register Pull-Down Gesture: Dismiss viewer
        touchManager.registerGesture('onPullDown', (totalY, state) => {
            if (zoomLevel > 1) return;

            if (state === 'start' || state === 'move') {
                // Visual feedback: slide down and scale slightly
                const progress = Math.min(totalY / 300, 1);
                const scale = 1 - (progress * 0.15);
                const opacity = 1 - (progress * 0.5);

                newImg.style.transition = 'none';
                newImg.style.transform = `translate(0, ${totalY * 0.5}px) scale(${scale})`;
                newImg.style.opacity = opacity;
                container.style.backgroundColor = `rgba(0,0,0,${0.9 * (1 - progress)})`;
            } else if (state === 'end') {
                if (totalY > 120) {
                    // Trigger dismissal
                    this.viewState.transition('explore');
                } else {
                    // Snap back
                    gsap.to(newImg, {
                        y: 0,
                        scale: 1,
                        opacity: 1,
                        duration: 0.3,
                        ease: "back.out(1.7)",
                        onUpdate: () => {
                            // Extract values from GSAP or just hardcode if simple
                        },
                        onComplete: () => {
                            newImg.style.transform = 'translate(0,0) scale(1)';
                            container.style.backgroundColor = '';
                        }
                    });
                    gsap.to(container, {
                        backgroundColor: 'rgba(0,0,0,0.9)',
                        duration: 0.3
                    });
                }
            }
        });

        touchManager.registerGesture('onTap', (touch) => {
            // Let onclick handle it
        });

        container.addEventListener('touchend', () => {
            // Cleanup handled by TouchManager
        });

        container.onpointermove = (e) => {
            if (!isDragging) return;
            pannedX = e.clientX - startX;
            pannedY = e.clientY - startY;
            newImg.style.transform = `translate(${pannedX}px, ${pannedY}px) scale(${zoomLevel})`;
        };

        container.onpointerup = (e) => {
            if (!isDragging) return;
            isDragging = false;
            newImg.style.cursor = 'grab';
            newImg.style.transition = 'transform 0.1s linear';
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
    }

    toggleMagnifier() {
        this.log(`toggleMagnifier called. Current state: ${this.viewState.getState()}`);

        if (this.mode === '3D') {
            const currentState = this.viewState.getState();

            if (currentState === 'detail') {
                // Exit DETAIL -> PREVIEW
                this.viewState.transition('preview');
            } else if (currentState === 'preview') {
                // Enter PREVIEW -> DETAIL
                this.mountActiveImage(this.currentIndex, 0);
                this.viewState.transition('detail');
            }
        } else {
            // 2D Mode: Use the explicit toggle handler if available
            const btn = document.getElementById('zoomBtn');
            const thumbs = document.getElementById('thumbnail-selector');

            if (this.ui.fullImageContainer.toggleZoom) {
                const isZoomed = this.ui.fullImageContainer.toggleZoom();

                // Update UI based on new state
                if (isZoomed) {
                    // Zoomed In
                    if (btn) {
                        btn.innerText = '🔙';
                        btn.title = "Reset Zoom";
                    }
                    if (thumbs) thumbs.classList.add('hidden');

                    // Hide Arrows
                    this.ui.leftArrow.hidden = true;
                    this.ui.rightArrow.hidden = true;
                } else {
                    // Zoomed Out (Reset)
                    if (btn) {
                        btn.innerText = '🔍';
                        btn.title = "Zoom / Magnify";
                    }
                    if (thumbs) thumbs.classList.remove('hidden');

                    // Restore Arrows (if not slideshow)
                    if (!this.isSlideshowActive) {
                        this.ui.leftArrow.hidden = false;
                        this.ui.rightArrow.hidden = false;
                    }
                }
            } else {
                // Fallback (Shouldn't happen if initialized correctly)
                console.warn("toggleZoom handler not found");
                const evt = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
                this.ui.fullImageContainer.dispatchEvent(evt);
            }
        }
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
        // Stop Slideshow
        if (this.isSlideshowActive) {
            this.stopSlideshow();
        }

        // Close Metadata (Always)
        this.ui.metadataViewer.classList.remove('visible');

        // Transition to EXPLORE state (handles all cleanup via hooks)
        this.viewState.transition('explore');

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
}

// Start App
window.onload = () => {
    window.galleryApp = new App();
};
