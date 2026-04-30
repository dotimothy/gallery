
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
        this.slideshowActivityTimer = null;
        this.viewerCloseTimer = null; // Prevent reliability issues

        // Elements
        this.ui = {
            title: document.getElementById('title'),
            toggle: document.getElementById('mode-toggle'),
            controlsContainer: document.getElementById('controls-container'), // New
            controlsToggle: document.getElementById('controls-toggle'), // New

            // Viewer Controls
            viewerControlsContainer: document.getElementById('viewer-controls-container'),
            viewerControlsToggle: document.getElementById('viewer-controls-toggle'),

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
            immersiveFrame: document.getElementById('immersive-frame'), // Added
            refresh: document.getElementById('refresh'),
        };

        // Initialize Views
        this.view3d = new View3D(document.getElementById('gallery-3d'));
        this.view2d = new View2D(document.getElementById('gallery-2d'));
        // (Init called in loadData)

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
        // EXPLORE/DETAIL -> PREVIEW: Single image fit-to-screen (viewer)
        this.viewState.registerHook('preview', 'onEnter', (fromState) => {
            this.log(`Entering PREVIEW state from ${fromState}`);

            // Standard Preview Initialization
            this.ui.imageViewer.hidden = false;
            this.ui.imageViewer.classList.add('visible');

            // 3D Rendering Management:
            // In 3D mode, PREVIEW is interactive Line View, so we MUST keep it rendering.
            // In 2D mode, the viewer is a solid overlay, so we should pause to save resources.
            if (this.mode === '3D') {
                this.view3d.resumeRendering();
            } else {
                this.view3d.pauseRendering();
            }

            // Logic specifically for returning from DETAIL (Magnifier)
            if (fromState === 'detail') {
                this.ui.fullImageContainer.style.display = 'none';

                // Restore 3D visibility components
                if (this.mode === '3D') {
                    document.getElementById('gallery-3d').style.display = 'block';
                    this.ui.imageViewer.classList.add('transparent');
                }

                // Update zoom button
                const zoomBtn = document.getElementById('zoomBtn');
                if (zoomBtn) {
                    const iconZoom = zoomBtn.querySelector('.icon-zoom');
                    const iconBack = zoomBtn.querySelector('.icon-back');
                    if (iconZoom) iconZoom.classList.remove('hidden');
                    if (iconBack) iconBack.classList.add('hidden');
                    zoomBtn.title = 'Zoom / Magnify';
                }

                // Restore arrows AND thumbnails if not in slideshow
                if (!this.isSlideshowActive) {
                    this.ui.leftArrow.hidden = false;
                    this.ui.rightArrow.hidden = false;

                    const thumbs = document.getElementById('thumbnail-selector');
                    if (thumbs) thumbs.classList.remove('hidden');
                }
            }
        });

        // PREVIEW -> DETAIL: Enter magnifier
        this.viewState.registerHook('detail', 'onEnter', (fromState) => {
            this.log('Entering DETAIL state');
            this.ui.imageViewer.classList.remove('transparent');
            this.ui.fullImageContainer.style.display = 'flex';

            // Completely hide 3D canvas and pause rendering to prevent event leakage/resource usage
            if (this.mode === '3D') {
                document.getElementById('gallery-3d').style.display = 'none';
                this.view3d.pauseRendering();
            }

            // Update zoom button
            const zoomBtn = document.getElementById('zoomBtn');
            if (zoomBtn) {
                const iconZoom = zoomBtn.querySelector('.icon-zoom');
                const iconBack = zoomBtn.querySelector('.icon-back');
                if (iconZoom) iconZoom.classList.add('hidden');
                if (iconBack) iconBack.classList.remove('hidden');
                zoomBtn.title = 'Return to Preview';
            }

            // Hide arrows in magnifier
            this.ui.leftArrow.hidden = true;
            this.ui.rightArrow.hidden = true;

            // Hide Thumbnails in Magnifier Mode
            const thumbs = document.getElementById('thumbnail-selector');
            if (thumbs) thumbs.classList.add('hidden');
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

            // Explicitly Hide arrows for Grid/Sphere
            this.ui.leftArrow.hidden = true;
            this.ui.rightArrow.hidden = true;

            // Hide Thumbs
            const thumbs = document.getElementById('thumbnail-selector');
            if (thumbs) thumbs.classList.add('hidden');
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
            if (!isNaN(interval) && interval > 0) {
                this.settings.set('slideshowInterval', interval / 1000);
            }
        }
        if (urlParams.has('slideshow')) {
            this.startSlideshow();
        }

        // Fullscreen (Chrome/Kiosk support)
        // Store flag to trigger on first interaction (opening viewer)
        if (urlParams.has('fullscreen')) {
            this.autoFullscreen = true;
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

            // 4. Init 3D View
            this.view3d.init(
                this.images,
                (index, openViewer) => this.selectImage(index, openViewer),
                (index) => this.preloadHighRes(index),
                this.isMobile,
                this.isDebug,
                () => { if (!this.isSlideshowActive) this.toggleMagnifier(); } // Auto-Magnify Callback
            );

            // 5. Init 2D View
            this.view2d.init(this.images, (index) => this.selectImage(index, true)); // Original selectImage

            // 6. Apply initial state and URL params
            this.switchMode(this.mode); // Reset to default first
            this.handleURLParams();
            this.typeTitle();

            // 7. Start App - Smooth Transition
            if (typeof gsap !== 'undefined') {
                const tl = gsap.timeline({
                    onComplete: () => {
                        if (this.ui.loadingScreen) this.ui.loadingScreen.classList.add('hidden');
                    }
                });

                // Fade out loading screen with a subtle zoom
                if (this.ui.loadingScreen) {
                    tl.to(this.ui.loadingScreen, {
                        opacity: 0,
                        scale: 1.05,
                        duration: 0.6,
                        ease: "power2.inOut",
                        pointerEvents: "none"
                    });
                }

                // Fade in Gallery & UI Elements (Staggered)
                const gallery3d = document.getElementById('gallery-3d');
                const gallery2d = document.getElementById('gallery-2d');
                const thumbs = document.getElementById('thumbnail-selector');
                const elementsToFade = [gallery3d, gallery2d, this.ui.title, this.ui.controlsContainer, thumbs].filter(Boolean);

                if (elementsToFade.length > 0) {
                    tl.fromTo(elementsToFade,
                        { opacity: 0, y: 10 },
                        { opacity: 1, y: 0, duration: 0.9, stagger: 0.06, ease: "power2.out" },
                        "-=0.3"
                    );
                }
            } else {
                // Fallback
                if (this.ui.loadingScreen) this.ui.loadingScreen.classList.add('hidden');
                const gallery3d = document.getElementById('gallery-3d');
                const gallery2d = document.getElementById('gallery-2d');
                const thumbs = document.getElementById('thumbnail-selector');
                const elements = [gallery3d, gallery2d, this.ui.title, this.ui.controlsContainer, thumbs].filter(Boolean);
                elements.forEach(el => el.style.opacity = '1');
            }

            // 8. Silent Background Preload
            this.preloadFullImages();

            // (Previous Init calls moved up)

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
        if (key === 'resolution' || key === 'sphereSpacing' || key === 'particleCount' || key === 'sensitivity') {
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
            'slideshowInterval': { id: 'disp-interval', suffix: 's' },
            'sensitivity': { id: 'disp-sensitivity', suffix: 'x' }
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
        const keys = ['resolution', 'sphereSpacing', 'particleCount', 'gridColumns', 'slideshowInterval', 'sensitivity'];
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
                        resolve();
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
            this.ui.globalFullscreen.addEventListener('click', () => this.toggleNativeFullscreen());
        }

        if (this.ui.refresh) {
            this.ui.refresh.onclick = () => location.reload();
        }

        if (this.ui.controlsToggle && this.ui.controlsContainer) {
            this.ui.controlsToggle.onclick = () => {
                this.ui.controlsContainer.classList.toggle('expanded');
                // Toggle Icon
                const iconMenu = this.ui.controlsToggle.querySelector('.icon-menu');
                const iconClose = this.ui.controlsToggle.querySelector('.icon-close');
                if (iconMenu && iconClose) {
                    iconMenu.classList.toggle('hidden');
                    iconClose.classList.toggle('hidden');
                }
            };
        }

        // Viewer Controls Toggle
        if (this.ui.viewerControlsToggle && this.ui.viewerControlsContainer) {
            this.ui.viewerControlsToggle.onclick = () => {
                this.ui.viewerControlsContainer.classList.toggle('expanded');
                // Toggle Icon
                const iconMenu = this.ui.viewerControlsToggle.querySelector('.icon-menu');
                const iconClose = this.ui.viewerControlsToggle.querySelector('.icon-close');
                if (iconMenu && iconClose) {
                    iconMenu.classList.toggle('hidden');
                    iconClose.classList.toggle('hidden');
                }
            };
        }

        // Monitor Fullscreen State Changes (Esc key, F11, etc.)
        document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
        document.addEventListener('webkitfullscreenchange', () => this.onFullscreenChange());
        document.addEventListener('mozfullscreenchange', () => this.onFullscreenChange());
        document.addEventListener('msfullscreenchange', () => this.onFullscreenChange());

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
            if (this.isSlideshowActive) this.resetSlideshowActivityTimer();
            this.touchStartX = e.changedTouches[0].screenX;
        }, { passive: false });

        document.addEventListener('touchend', (e) => {
            if (this.isSlideshowActive) this.resetSlideshowActivityTimer();
            this.touchEndX = e.changedTouches[0].screenX;
            this.handleSwipe();
        });

        // Activity Monitor for Slideshow
        document.addEventListener('mousemove', () => {
            if (this.isSlideshowActive) this.resetSlideshowActivityTimer();
        });
        document.addEventListener('click', () => {
            if (this.isSlideshowActive) this.resetSlideshowActivityTimer();
        });

        // Metadata Toggles
        this.ui.toggleMetadata.onclick = () => this.toggleMetadata();

        // Viewer Controls
        this.ui.exitViewer.onclick = () => this.closeFullscreen();
        if (this.ui.fullscreenToggle) {
            this.ui.fullscreenToggle.addEventListener('click', () => this.toggleNativeFullscreen());
        }
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

        // License Overlay Logic
        const openLicenseBtn = document.getElementById('openLicense');
        const closeLicenseBtn = document.getElementById('closeLicense');
        const licenseOverlay = document.getElementById('licenseOverlay');

        if (openLicenseBtn && licenseOverlay) {
            openLicenseBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showLicense();
            };

            if (closeLicenseBtn) closeLicenseBtn.onclick = () => this.hideLicense();

            // Close on click outside
            licenseOverlay.onclick = (e) => {
                if (e.target === licenseOverlay) this.hideLicense();
            };
        }

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
        bindInput('set-sensitivity', 'sensitivity', true);

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
        // Listen for messages from Independent Viewers (Immersive & License)
        window.addEventListener('message', (e) => {
            if (e.data.action === 'close') {
                this.closeFullscreen();
            } else if (e.data.action === 'closeLicense') {
                this.hideLicense();
            } else if (e.data.action === 'next') {
                this.next(true); // Determine next index -> update iframe
            } else if (e.data.action === 'prev') {
                this.prev();
            } else if (e.data.action === 'startSlideshow') {
                if (!this.isSlideshowActive) this.startSlideshow();
            } else if (e.data.action === 'stopSlideshow') {
                if (this.isSlideshowActive) this.stopSlideshow();
            }
        });

        // Global Escape for any open overlays when focus is on parent
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const licenseOverlay = document.getElementById('licenseOverlay');
                if (licenseOverlay && licenseOverlay.classList.contains('visible')) {
                    this.hideLicense();
                }
            }
        });
    }

    handleSwipe() {
        // 1. ONLY navigate if the viewer is open. 
        // If hidden, we are probably rotating the 3D sphere or browsing the 2D grid.
        if (this.ui.imageViewer.hidden) return;

        // 2. Block navigation ONLY if specifically zoomed in (panning)
        if (this.viewState.getState() === 'detail') return;
        if (this.ui.fullImageContainer.isZoomed && this.ui.fullImageContainer.isZoomed()) return;

        if (Math.abs(this.touchStartX - this.touchEndX) > this.swipeThresh) {
            if (this.touchEndX < this.touchStartX) this.next();
            if (this.touchEndX > this.touchStartX) this.prev();
        }
    }

    switchMode(newMode) {
        // ALWAYS close fullscreen/viewer when switching modes.
        this.closeFullscreen();

        this.mode = newMode;
        if (this.ui.toggle) this.ui.toggle.innerText = newMode === '3D' ? '2D' : '3D';

        if (newMode === '3D') {
            this.view2d.hide();
            this.view3d.show(); // This calls resumeRendering() internal to View3D
            this.view3d.resize();

            this.ui.leftArrow.hidden = true;
            this.ui.rightArrow.hidden = true;
        } else {
            this.view3d.hide(); // This calls pauseRendering() internal to View3D
            this.view2d.show();

            this.ui.leftArrow.hidden = true;
            this.ui.rightArrow.hidden = true;
        }
    }

    selectImage(index, openViewer = false, direction = 0) {
        // If we are already in detail mode, stay there and update the content
        const isDetail = this.viewState.getState() === 'detail';

        this.log(`selectImage Idx:${index} Open:${openViewer} Detail:${isDetail}`);
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
            const iconPlay = this.ui.viewerSlideshow.querySelector('.icon-play');
            const iconPause = this.ui.viewerSlideshow.querySelector('.icon-pause');
            if (iconPlay) iconPlay.classList.add('hidden');
            if (iconPause) iconPause.classList.remove('hidden');
            this.ui.viewerSlideshow.title = "Stop Slideshow";
        }

        // Feature: Slideshow "goes into image viewer"
        // Ensure viewer is open AND update state (hide arrows, zoom 3D)
        this.selectImage(this.currentIndex, true);

        // Hide Thumbs for Slideshow
        const thumbs = document.getElementById('thumbnail-selector');
        if (thumbs) thumbs.classList.add('hidden');

        // Start Activity Timer to hide controls
        this.resetSlideshowActivityTimer();

        // IMMEDIATE FADE: Override the default 3s timer for the initial start
        if (this.slideshowActivityTimer) clearTimeout(this.slideshowActivityTimer);
        this.slideshowActivityTimer = setTimeout(() => {
            if (this.isSlideshowActive) this.toggleControlsVisibility(false);
        }, 500);

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

        if (this.slideshowActivityTimer) {
            clearTimeout(this.slideshowActivityTimer);
            this.slideshowActivityTimer = null;
        }

        // Ensure controls are visible when stopping
        this.toggleControlsVisibility(true);

        if (this.ui.viewerSlideshow) {
            const iconPlay = this.ui.viewerSlideshow.querySelector('.icon-play');
            const iconPause = this.ui.viewerSlideshow.querySelector('.icon-pause');
            if (iconPlay) iconPlay.classList.remove('hidden');
            if (iconPause) iconPause.classList.add('hidden');
            this.ui.viewerSlideshow.title = "Start Slideshow";
        }

        // Restore UI state (Arrows, standard zoom)
        this.selectImage(this.currentIndex, true);

        // Restore Thumbs
        const thumbs = document.getElementById('thumbnail-selector');
        if (thumbs) thumbs.classList.remove('hidden');
    }

    resetSlideshowActivityTimer() {
        this.toggleControlsVisibility(true);
        if (this.slideshowActivityTimer) clearTimeout(this.slideshowActivityTimer);

        this.slideshowActivityTimer = setTimeout(() => {
            if (this.isSlideshowActive) {
                this.toggleControlsVisibility(false);
            }
        }, 3000);
    }

    toggleControlsVisibility(show) {
        const controls = [
            this.ui.viewerControlsContainer,
            this.ui.leftArrow,
            this.ui.rightArrow,
            // Add top controls too if they are visible? Usually viewer covers them.
        ];

        controls.forEach(el => {
            if (!el) return;
            if (show) el.classList.remove('fade-out');
            else el.classList.add('fade-out');
        });

        // Also hide/show cursor?
        this.ui.imageViewer.style.cursor = show ? 'auto' : 'none';
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
            const focalLength = data['EXIF FocalLength'] ? safeEval(data['EXIF FocalLength']) : 'N/A';
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
            html += `<p>ISO ${iso} | ${focalLength}mm | F${f} | ${exp}" s</p>`;

        } else {
            html += `<p>No metadata available.</p>`;
        }

        this.ui.metadataViewer.innerHTML = html;
    }

    toggleMetadata() {
        if (this.ui.metadataViewer.classList.contains('hidden')) {
            this.ui.metadataViewer.classList.remove('hidden');
            this.ui.metadataViewer.classList.add('visible');
        } else {
            this.ui.metadataViewer.classList.add('hidden');
            this.ui.metadataViewer.classList.remove('visible');
        }
    }

    activateImmersiveViewer(index) {
        const iframe = this.ui.immersiveFrame;
        if (!iframe) return;

        // Ensure Metadata Panel is hidden
        if (this.ui.metadataViewer) this.ui.metadataViewer.classList.remove('visible');

        // Show Iframe Container
        iframe.classList.remove('hidden');
        iframe.style.display = 'block';

        // Hide Viewer Controls (User Request 1/2)
        // Hide Viewer Controls (User Request 1/2) - FORCE HIDE
        if (this.ui.viewerControlsContainer) {
            this.ui.viewerControlsContainer.style.display = 'none';
        }
        // Also hide Global Controls Container
        if (this.ui.controlsContainer) {
            this.ui.controlsContainer.style.display = 'none';
        }

        // Construct URL
        const imgName = this.images[index];
        const dir = this.useDataSaver ? 'thumbs' : 'fulls';

        let nextIdx = index + 1;
        if (nextIdx >= this.images.length) nextIdx = 0;
        let prevIdx = index - 1;
        if (prevIdx < 0) prevIdx = this.images.length - 1;

        const mainPath = `./${dir}/${imgName}.jpg`;
        const nextPath = `./${dir}/${this.images[nextIdx]}.jpg`;
        const prevPath = `./${dir}/${this.images[prevIdx]}.jpg`;

        let url = `immersive.html?img=${encodeURIComponent(mainPath)}`;
        url += `&next=${encodeURIComponent(nextPath)}`;
        url += `&prev=${encodeURIComponent(prevPath)}`;

        if (this.isSlideshowActive) {
            url += `&slideshow=1`;
            url += `&interval=${this.slideshowInterval}`;
        }

        if (this.metadata[imgName]) {
            const m = this.metadata[imgName];
            if (m['Image DateTime']) url += `&meta_date=${encodeURIComponent(m['Image DateTime'])}`;
            if (m['Image Model']) url += `&meta_model=${encodeURIComponent(m['Image Model'])}`;
            if (m['EXIF ISOSpeedRatings']) url += `&meta_iso=${encodeURIComponent(m['EXIF ISOSpeedRatings'])}`;
            if (m['EXIF ExposureTime']) url += `&meta_shutter=${encodeURIComponent(m['EXIF ExposureTime'])}`;
            if (m['EXIF FNumber']) url += `&meta_fstop=${encodeURIComponent(m['EXIF FNumber'])}`;
        }

        // Update if different (prevents reloading if just showing/hiding, but we usually want to update state)
        if (iframe.contentWindow && iframe.src.indexOf(url) === -1) {
            iframe.src = url;
            iframe.contentWindow.focus();
        } else {
            iframe.contentWindow.focus();
        }
    }

    async openFullscreenViewer(index, direction = 0) {
        if (this.viewerCloseTimer) {
            clearTimeout(this.viewerCloseTimer);
            this.viewerCloseTimer = null;
        }

        this.log(`Opening Viewer Idx:${index} Mode:${this.mode}`);

        // Auto-Fullscreen Trigger (User Gesture)
        if (this.autoFullscreen) {
            try {
                const el = document.documentElement;
                if (!document.fullscreenElement) {
                    // Try to wait for fullscreen to engage before transitioning
                    // This reduces jank/flicker as the browser resizes the window.
                    if (el.requestFullscreen) await el.requestFullscreen();
                    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
                    else if (el.msRequestFullscreen) await el.msRequestFullscreen();

                    // Small buffer to allow resize events to propagate
                    await new Promise(r => setTimeout(r, 100));
                }
            } catch (e) {
                console.warn("Fullscreen trigger failed:", e);
            }
        }

        if (this.mode === '3D') {
            const isDetail = this.viewState.getState() === 'detail';

            if (isDetail) {
                this.activateImmersiveViewer(index);
                this.updateMetadata(index);
                this.updateThumbSelector(index);
                return;
            }

            // 3D Preview Mode (Line View)
            const iframe = this.ui.immersiveFrame;
            if (iframe) {
                iframe.classList.add('hidden');
                iframe.style.display = 'none';
            }

            // Ensure 3D Canvas is VISIBLE
            document.getElementById('gallery-3d').style.display = 'block';
            this.view3d.resumeRendering();

            // Transition State
            if (this.viewState.getState() !== 'preview') {
                this.viewState.transition('preview');
            }
            this.view3d.enterLineView(index);
            // Hide Global Top Controls to prevent overlap
            if (this.ui.controlsContainer) {
                this.ui.controlsContainer.style.opacity = '0';
                this.ui.controlsContainer.style.pointerEvents = 'none';
            }
            if (this.ui.title) this.ui.title.style.opacity = '0';

            // Show DOM Controls (Arrows, Zoom Btn) BUT CLEAR IMAGE
            this.ui.fullImageContainer.innerHTML = '';
            this.ui.imageViewer.hidden = false;
            this.ui.imageViewer.classList.add('visible');
            this.ui.imageViewer.classList.add('transparent'); // Let 3D show through

            // Ensure Zoom button is "Magnify"
            const zoomBtn = document.getElementById('zoomBtn');
            if (zoomBtn) {
                const iconZoom = zoomBtn.querySelector('.icon-zoom');
                const iconBack = zoomBtn.querySelector('.icon-back');
                if (iconZoom) iconZoom.classList.remove('hidden');
                if (iconBack) iconBack.classList.add('hidden');
                zoomBtn.title = 'Magnify';
            }

            // Metadata & Thumbs
            this.updateMetadata(index);
            if (!this.thumbnailsCreated) { this.createThumbSelector(); this.thumbnailsCreated = true; }
            this.updateThumbSelector(index);

        } else {
            // 2D Mode -> Use Legacy Viewer for PREVIEW (Restores Navigation)
            // The unified Immersive Viewer (Iframe) is only used when MAGNIFIED in 2D.
            // This restores the "transition between images" capability using the global arrows.

            // Ensure 3D is hidden/paused
            this.view3d.pauseRendering();

            // Transition State
            if (this.viewState.getState() !== 'preview') {
                this.viewState.transition('preview');
            }

            // Hide Iframe (if it was active)
            if (this.ui.immersiveFrame) {
                this.ui.immersiveFrame.classList.add('hidden');
                this.ui.immersiveFrame.style.display = 'none';
            }

            // Show Legacy Viewer (Overlay)
            this.ui.imageViewer.hidden = false;
            this.ui.imageViewer.classList.add('visible');
            this.ui.imageViewer.classList.remove('transparent'); // Solid background for 2D
            this.ui.fullImageContainer.style.display = 'flex';

            // Override Cursor
            this.ui.imageViewer.style.cursor = 'auto';

            // Metadata & Thumbs
            this.updateMetadata(index);
            if (!this.thumbnailsCreated) { this.createThumbSelector(); this.thumbnailsCreated = true; }
            this.updateThumbSelector(index);

            // RESTORE ARROWS for Navigation
            this.ui.leftArrow.hidden = false;
            this.ui.rightArrow.hidden = false;

            // Zoom Button -> "Magnify"
            const zoomBtn = document.getElementById('zoomBtn');
            if (zoomBtn) {
                const iconZoom = zoomBtn.querySelector('.icon-zoom');
                const iconBack = zoomBtn.querySelector('.icon-back');
                if (iconZoom) iconZoom.classList.remove('hidden');
                if (iconBack) iconBack.classList.add('hidden');
                zoomBtn.title = 'Enter Immersive View';
            }

            // Hide Global UI Overlay (Title, Top Controls)
            if (this.ui.controlsContainer) {
                this.ui.controlsContainer.style.opacity = '0';
                this.ui.controlsContainer.style.pointerEvents = 'none';
            }
            if (this.ui.title) this.ui.title.style.opacity = '0';

            // Hide 2D Grid
            const g2d = document.getElementById('gallery-2d');
            if (g2d) g2d.style.display = 'none';

            // Mount the Image (Legacy Way)
            this.mountActiveImage(index, direction);
        }
    }

    mountActiveImage(index, direction = 0) {
        this.log(`mountActiveImage called for Idx:${index}`);
        const imgName = this.images[index];
        const container = this.ui.fullImageContainer;

        // --- 1. CLEANUP & UI RESET ---
        const zoomBtn = document.getElementById('zoomBtn');
        if (zoomBtn) {
            const iconZoom = zoomBtn.querySelector('.icon-zoom');
            const iconBack = zoomBtn.querySelector('.icon-back');
            if (iconZoom) iconZoom.classList.remove('hidden');
            if (iconBack) iconBack.classList.add('hidden');
            zoomBtn.title = 'Use Scroll Wheel or Pinch to Zoom';
        }

        const oldImg = container.querySelector('img.active');
        const oldOverlay = container.querySelector('.input-overlay');

        if (oldOverlay) oldOverlay.remove();

        // Handle Old Image Exit
        if (oldImg) {
            oldImg.classList.remove('active');
            oldImg.style.zIndex = '0';

            if (direction !== 0) {
                const exitX = direction > 0 ? '-100%' : '100%';
                oldImg.style.transition = 'transform 0.4s ease-in-out, opacity 0.4s ease';
                oldImg.style.transform = `translate(${exitX}, 0) scale(1)`;
                oldImg.style.opacity = '0.5';
            } else {
                oldImg.style.opacity = 0;
            }
            setTimeout(() => { if (oldImg.parentElement) oldImg.remove(); }, 500);
        }

        // --- 2. SETUP NEW VISUALS ---
        const newImg = document.createElement('img');
        newImg.className = 'active';

        Object.assign(newImg.style, {
            opacity: '0',
            position: 'absolute',
            maxWidth: '100%',
            maxHeight: '100%',
            width: 'auto',
            height: 'auto',
            objectFit: 'contain',
            transformOrigin: 'center center',
            zIndex: '10',
            pointerEvents: 'none',
            userSelect: 'none',
            webkitUserSelect: 'none',
            transition: 'none'
        });

        if (direction !== 0) {
            const enterX = direction > 0 ? '100%' : '-100%';
            newImg.style.transform = `translate(${enterX}, 0) scale(1)`;
        } else {
            newImg.style.transform = 'translate(0, 0) scale(1)';
        }

        // --- 3. SETUP INPUT OVERLAY ---
        const overlay = document.createElement('div');
        overlay.className = 'input-overlay';
        Object.assign(overlay.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            zIndex: '20',
            cursor: 'default',
            touchAction: 'none'
        });

        // --- 4. STATE VARIABLES ---
        let zoomLevel = 1;
        let pannedX = 0;
        let pannedY = 0;
        let isDragging = false;
        let startX = 0, startY = 0;

        // --- 5. TRANSFORM LOGIC ---
        const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

        const updateTransform = (animate = false) => {
            if (animate) {
                newImg.style.transition = 'transform 0.3s cubic-bezier(0.1, 0.57, 0.1, 1)';
            } else {
                newImg.style.transition = 'none';
            }

            const currentW = newImg.offsetWidth * zoomLevel;
            const currentH = newImg.offsetHeight * zoomLevel;
            const screenW = container.offsetWidth;
            const screenH = container.offsetHeight;

            const maxX = currentW > screenW ? (currentW - screenW) / 2 : 0;
            const maxY = currentH > screenH ? (currentH - screenH) / 2 : 0;

            pannedX = clamp(pannedX, -maxX, maxX);
            pannedY = clamp(pannedY, -maxY, maxY);

            newImg.style.transform = `translate(${pannedX}px, ${pannedY}px) scale(${zoomLevel})`;

            if (zoomLevel > 1) {
                overlay.style.cursor = isDragging ? 'grabbing' : 'grab';
            } else {
                overlay.style.cursor = 'default';
            }
        };

        // --- FIX: DEFINE TOGGLE ZOOM HANDLER ---
        // This attaches the internal state (zoomLevel) to the container so the button can use it
        container.toggleZoom = () => {
            if (zoomLevel > 1) {
                // Reset to 1x
                zoomLevel = 1;
                pannedX = 0;
                pannedY = 0;
                updateTransform(true);
                return false; // isZoomed = false
            } else {
                // Zoom In to 2.5x
                zoomLevel = 2.5;
                updateTransform(true);
                return true; // isZoomed = true
            }
        };

        container.isZoomed = () => zoomLevel > 1;


        // --- 6. EVENT LISTENERS (On Overlay) ---
        overlay.onwheel = (e) => {
            e.preventDefault();
            const delta = -Math.sign(e.deltaY) * 0.2;
            const nextZoom = Math.min(Math.max(1, zoomLevel + delta), 5);

            if (nextZoom !== zoomLevel) {
                zoomLevel = nextZoom;
                if (zoomLevel === 1) { pannedX = 0; pannedY = 0; }
                updateTransform(false);
            }
        };

        overlay.ondblclick = (e) => {
            e.preventDefault();
            // Manually trigger the toggle and update UI button state if needed
            const isNowZoomed = container.toggleZoom();

            // Optional: Sync the Zoom Button UI immediately
            if (zoomBtn) {
                const iconZoom = zoomBtn.querySelector('.icon-zoom');
                const iconBack = zoomBtn.querySelector('.icon-back');
                if (isNowZoomed) {
                    if (iconZoom) iconZoom.classList.add('hidden');
                    if (iconBack) iconBack.classList.remove('hidden');
                    zoomBtn.title = "Reset Zoom";
                } else {
                    if (iconZoom) iconZoom.classList.remove('hidden');
                    if (iconBack) iconBack.classList.add('hidden');
                    zoomBtn.title = "Zoom / Magnify";
                }
            }
        };

        overlay.onpointerdown = (e) => {
            if (e.pointerType === 'touch') return;
            if (zoomLevel <= 1) return;

            e.preventDefault();
            isDragging = true;
            startX = e.clientX - pannedX;
            startY = e.clientY - pannedY;
            overlay.setPointerCapture(e.pointerId);
            updateTransform(false);
        };

        overlay.onpointermove = (e) => {
            if (!isDragging) return;
            e.preventDefault();
            pannedX = e.clientX - startX;
            pannedY = e.clientY - startY;
            updateTransform(false);
        };

        overlay.onpointerup = (e) => {
            if (!isDragging) return;
            isDragging = false;
            overlay.releasePointerCapture(e.pointerId);
            updateTransform(true);
        };

        // Touch Manager
        const touchManager = new TouchManager(overlay);
        touchManager.setHysteresis(1.05, 0.98);

        touchManager.registerGesture('onPinch', (scale, thresholds) => {
            const currentState = this.viewState.getState();
            if (this.mode === '3D' && currentState === 'preview' && scale > thresholds.enterThreshold && !this.isMobile) {
                this.viewState.transition('detail');
            }

            if (currentState === 'detail' || this.mode === '2D' || currentState === 'preview') {
                // NEW LOGIC: Use the frame-to-frame scale for smoother movement
                const frameScale = thresholds.frameScale || 1;

                // Sensitivity of 1.0 makes it 1:1 with finger movement
                const sensitivity = 1.0;
                const delta = (frameScale - 1) * sensitivity;

                let nextZoom = zoomLevel + delta;
                nextZoom = Math.min(Math.max(1, nextZoom), 5);

                if (nextZoom !== zoomLevel) {
                    zoomLevel = nextZoom;
                    // Reset panning if we are back at 1x zoom
                    if (zoomLevel === 1) { pannedX = 0; pannedY = 0; }
                    updateTransform(false);
                }
            }
        });

        touchManager.registerGesture('onPan', (incX, incY, state) => {
            if (zoomLevel <= 1) return;
            if (state === 'start') {
                newImg.style.transition = 'none';
            } else if (state === 'move') {
                pannedX += incX;
                pannedY += incY;
                updateTransform(false);
            } else if (state === 'end') {
                updateTransform(true);
            }
        });

        touchManager.registerGesture('onPullDown', (totalY, state) => {
            if (zoomLevel > 1) return;
            if (state === 'move') {
                const progress = Math.min(totalY / 300, 1);
                const scale = 1 - (progress * 0.15);
                newImg.style.transform = `translate(0, ${totalY * 0.5}px) scale(${scale})`;
                container.style.backgroundColor = `rgba(0,0,0,${0.9 * (1 - progress)})`;
            } else if (state === 'end') {
                if (totalY > 120 && !this.isMobile) {
                    this.viewState.transition('explore');
                } else {
                    newImg.style.transition = 'transform 0.3s ease-out';
                    newImg.style.transform = 'translate(0,0) scale(1)';
                    container.style.backgroundColor = 'rgba(0,0,0,0.9)';
                }
            }
        });

        touchManager.registerGesture('onTap', () => {
            const currentState = this.viewState.getState();
            if (this.mode === '3D' && currentState === 'preview') {
                this.viewState.transition('detail');
            } else if (this.mode === '2D' && currentState === 'preview') {
                this.toggleMagnifier();
            }
        });

        // --- 7. LOAD HANDLING ---
        let loader = null;
        const loaderTimeout = setTimeout(() => {
            loader = document.createElement('div');
            loader.className = 'loader';
            container.appendChild(loader);
        }, 500);

        newImg.onload = () => {
            clearTimeout(loaderTimeout);
            if (loader && loader.parentNode) loader.parentNode.removeChild(loader);

            newImg.getBoundingClientRect();

            requestAnimationFrame(() => {
                newImg.style.transition = 'transform 0.4s ease-out, opacity 0.4s ease';
                newImg.style.opacity = '1';
                newImg.style.transform = 'translate(0, 0) scale(1)';
            });

            if (!this.thumbnailsCreated) {
                this.createThumbSelector();
                this.thumbnailsCreated = true;
            }
            this.updateThumbSelector(index);
        };

        // --- 8. MOUNT & SET SRC ---
        container.appendChild(newImg);
        container.appendChild(overlay);

        // Datasaver Logic
        const dir = this.useDataSaver ? 'thumbs' : 'fulls';
        newImg.src = `./${dir}/${imgName}.jpg`;
    }

    toggleMagnifier() {
        const currentState = this.viewState.getState();
        if (this.mode === '3D') {
            if (currentState === 'preview') {
                // Enter DETAIL (Immersive Iframe)
                this.viewState.transition('detail');

                // Hide 3D, Show Iframe
                this.view3d.pauseRendering();
                document.getElementById('gallery-3d').style.display = 'none';

                this.activateImmersiveViewer(this.currentIndex);

                // --- CLEAN UI FIX ---
                // Hide Legacy Viewer and its global controls (Thumb viewer, Info, Zoom/Magnify, etc.)
                this.ui.imageViewer.hidden = true;
                this.ui.imageViewer.classList.remove('visible');

                // Hide Global UI Overlay (Title, Top Controls)
                if (this.ui.controlsContainer) {
                    this.ui.controlsContainer.style.opacity = '0';
                    this.ui.controlsContainer.style.pointerEvents = 'none';
                }
                if (this.ui.title) this.ui.title.style.opacity = '0';

                // Hide Navigation Arrows & Thumbs
                this.ui.leftArrow.hidden = true;
                this.ui.rightArrow.hidden = true;
                const thumbs = document.getElementById('thumbnail-selector');
                if (thumbs) thumbs.classList.add('hidden');

            } else if (currentState === 'detail') {
                // Exit DETAIL -> PREVIEW (Stay in Line View)
                this.viewState.transition('preview');

                // Hide Iframe, Show 3D
                this.ui.immersiveFrame.classList.add('hidden');
                this.ui.immersiveFrame.style.display = 'none';
                this.ui.immersiveFrame.src = 'about:blank'; // Stop media
                window.focus(); // Restore focus to main window for keyboard events

                document.getElementById('gallery-3d').style.display = 'block';
                this.view3d.resumeRendering();

                // Ensure we stay in Line View centered on current item
                this.view3d.enterLineView(this.currentIndex);

                // Restore Legacy Viewer visibility for preview logic (controls overlay)
                this.ui.imageViewer.hidden = false;
                this.ui.imageViewer.classList.add('visible');
                this.ui.imageViewer.classList.add('transparent');

                // Restore Viewer Controls (User Request 1/2)
                if (this.ui.viewerControlsContainer) {
                    this.ui.viewerControlsContainer.style.display = 'flex';
                }
                // Restore Global Controls Container
                if (this.ui.controlsContainer) {
                    this.ui.controlsContainer.style.display = 'flex';
                }

                const zoomBtn = document.getElementById('zoomBtn');
                if (zoomBtn) {
                    const iconZoom = zoomBtn.querySelector('.icon-zoom');
                    const iconBack = zoomBtn.querySelector('.icon-back');
                    if (iconZoom) iconZoom.classList.remove('hidden');
                    if (iconBack) iconBack.classList.add('hidden');
                }
                const thumbs = document.getElementById('thumbnail-selector');
                if (thumbs) thumbs.classList.remove('hidden');

                // Restore Global Arrows (if not slideshow)
                if (!this.isSlideshowActive) {
                    this.ui.leftArrow.hidden = false;
                    this.ui.rightArrow.hidden = false;
                }
            }
        } else {
            // 2D Mode: Toggle between Legacy Preview and Immersive Viewer
            if (currentState === 'preview') {
                // Enter Immersive Viewer
                this.viewState.transition('detail');

                // Hide Legacy Image & Viewer UI
                this.ui.fullImageContainer.style.display = 'none';
                this.ui.imageViewer.hidden = true;
                this.ui.imageViewer.classList.remove('visible');

                // Activate Iframe
                this.activateImmersiveViewer(this.currentIndex);

                // Hide Global UI
                if (this.ui.controlsContainer) {
                    this.ui.controlsContainer.style.opacity = '0';
                    this.ui.controlsContainer.style.pointerEvents = 'none';
                }
                if (this.ui.title) this.ui.title.style.opacity = '0';

                // Hide Arrows, Thumbs & Grid
                this.ui.leftArrow.hidden = true;
                this.ui.rightArrow.hidden = true;
                const thumbs = document.getElementById('thumbnail-selector');
                if (thumbs) thumbs.classList.add('hidden');
                document.getElementById('gallery-2d').style.display = 'none';

            } else {
                // Exit Immersive -> Back to Legacy Preview
                this.viewState.transition('preview');

                // Hide Iframe
                this.ui.immersiveFrame.classList.add('hidden');
                this.ui.immersiveFrame.style.display = 'none';
                this.ui.immersiveFrame.src = 'about:blank'; // Clear to stop media/memory
                window.focus(); // Restore focus to main window for keyboard events

                // Keep Grid Hidden in Preview (consistent with openFullscreenViewer 2D)
                document.getElementById('gallery-2d').style.display = 'none';

                // Restore Legacy Image & Viewer UI
                this.ui.fullImageContainer.style.display = 'flex';
                this.ui.imageViewer.hidden = false;
                this.ui.imageViewer.classList.add('visible');
                this.ui.imageViewer.classList.remove('transparent');

                // Restore Viewer Controls (User Request 1/2)
                if (this.ui.viewerControlsContainer) {
                    this.ui.viewerControlsContainer.style.display = 'flex';
                }
                // Restore Global Controls Container
                if (this.ui.controlsContainer) {
                    this.ui.controlsContainer.style.display = 'flex';
                }

                // Restore Buttons
                const btn = document.getElementById('zoomBtn');
                if (btn) {
                    const iconZoom = btn.querySelector('.icon-zoom');
                    const iconBack = btn.querySelector('.icon-back');
                    if (iconZoom) iconZoom.classList.remove('hidden');
                    if (iconBack) iconBack.classList.add('hidden');
                    btn.title = "Enter Immersive View";
                }

                // Restore Arrows & Thumbs
                if (!this.isSlideshowActive) {
                    this.ui.leftArrow.hidden = false;
                    this.ui.rightArrow.hidden = false;
                }
                const thumbs = document.getElementById('thumbnail-selector');
                if (thumbs) thumbs.classList.remove('hidden');
            }
        }
    }

    closeFullscreen() {
        const currentState = this.viewState.getState();
        this.log(`closeFullscreen called from state: ${currentState}`);

        // Stop Slideshow
        if (this.isSlideshowActive) this.stopSlideshow();

        if (currentState === 'detail') {
            // If in DETAIL (Immersive Frame), return to PREVIEW (Line View / Legacy Overlay)
            this.toggleMagnifier();
            return;
        }

        // 1. Hide Iframe (Immersive Viewer)
        const iframe = this.ui.immersiveFrame;
        if (iframe) {
            iframe.classList.add('hidden');
            iframe.style.display = 'none';
            iframe.src = 'about:blank'; // Clear to stop media/memory
        }

        // 2. Hide Legacy Viewer (2DOverlay)
        if (this.ui.imageViewer) {
            this.ui.imageViewer.classList.remove('visible');
            this.ui.imageViewer.hidden = true;
            this.ui.imageViewer.style.cursor = 'auto'; // Reset cursor
        }

        if (this.ui.fullImageContainer) {
            this.ui.fullImageContainer.innerHTML = '';
            this.ui.fullImageContainer.style.display = 'none';
        }

        // 3. Close Metadata, Thumbs & Arrows
        if (this.ui.metadataViewer) this.ui.metadataViewer.classList.remove('visible');
        const thumbs = document.getElementById('thumbnail-selector');
        if (thumbs) thumbs.classList.add('hidden');
        if (this.ui.leftArrow) this.ui.leftArrow.hidden = true;
        if (this.ui.rightArrow) this.ui.rightArrow.hidden = true;

        // 4. TRANSITION STATE
        // Transition -> 'explore' (Sphere/Grid)
        this.viewState.transition('explore');

        // Force Canvas Visibility & Resume
        if (this.mode === '3D') {
            const g3d = document.getElementById('gallery-3d');
            if (g3d) {
                g3d.style.display = 'block';
                requestAnimationFrame(() => {
                    this.view3d.resumeRendering();
                    // Exit line view to return to sphere
                    this.view3d.exitLineView();
                });
            }
        } else {
            const g2d = document.getElementById('gallery-2d');
            if (g2d) g2d.style.display = 'grid';
        }

        // 5. Restore Global UI
        if (this.ui.controlsContainer) {
            this.ui.controlsContainer.style.opacity = '1';
            this.ui.controlsContainer.style.pointerEvents = 'auto';
            this.ui.controlsContainer.style.visibility = 'visible';
        }
        if (this.ui.title) this.ui.title.style.opacity = '0.9';

        this.log("Fullscreen Closed. Returned to Explore.");
    }

    showLicense() {
        const overlay = document.getElementById('licenseOverlay');
        const iframe = document.getElementById('licenseIframe');
        if (overlay && iframe) {
            iframe.src = 'license.html';
            overlay.classList.add('visible');
        }
    }

    hideLicense() {
        const overlay = document.getElementById('licenseOverlay');
        const iframe = document.getElementById('licenseIframe');
        if (overlay && iframe) {
            overlay.classList.remove('visible');
            setTimeout(() => {
                iframe.src = 'about:blank';
                window.focus();
            }, 300);
        }
    }

    createThumbSelector() {
        const container = document.getElementById('thumbnail-selector');
        if (!container) return;
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
        const toggleBtn = document.getElementById('toggleThumbs');
        if (toggleBtn) {
            toggleBtn.onclick = (e) => {
                e.stopPropagation();
                container.classList.toggle('hidden');
            };
        }
    }

    updateThumbSelector(index) {
        const container = document.getElementById('thumbnail-selector');
        if (!container) return;
        const thumbs = container.querySelectorAll('.thumb-small');
        thumbs.forEach(t => t.classList.remove('active'));
        if (thumbs[index]) {
            thumbs[index].classList.add('active');
            thumbs[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    toggleNativeFullscreen() {
        const doc = window.document;
        const docEl = doc.documentElement;

        const isFS = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);

        if (!isFS) {
            // Enter Fullscreen
            const request = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
            if (request) {
                const p = request.call(docEl);
                if (p && p.catch) p.catch(err => console.error("Fullscreen error:", err));
            }
        } else {
            // Exit Fullscreen
            const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
            if (exit) {
                const p = exit.call(doc);
                if (p && p.catch) p.catch(err => console.error("Exit Fullscreen error:", err));
            }
        }
    }

    onFullscreenChange() {
        const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
        this.log(`Fullscreen State: ${isFS}`);

        // Update All Fullscreen Buttons
        const btns = [this.ui.globalFullscreen, this.ui.fullscreenToggle].filter(Boolean);
        btns.forEach(btn => {
            const iconExpand = btn.querySelector('.icon-expand');
            const iconCompress = btn.querySelector('.icon-compress');
            if (iconExpand && iconCompress) {
                if (isFS) {
                    iconExpand.classList.add('hidden');
                    iconCompress.classList.remove('hidden');
                    btn.title = 'Exit Fullscreen';
                } else {
                    iconExpand.classList.remove('hidden');
                    iconCompress.classList.add('hidden');
                    btn.title = 'Go Fullscreen';
                }
            }
        });

        // Feature: Auto-close viewer on fullscreen exit (User Request)
        // If we just exited fullscreen, close the viewer experience to sync states.
        if (!isFullscreen) {
            this.closeFullscreen();
        }
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
