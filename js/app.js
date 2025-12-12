
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
            metadataViewer: document.getElementById('metadataViewer'),
            toggleMetadata: document.getElementById('toggleMetadata'),
            imageViewer: document.getElementById('imageViewer'),
            exitViewer: document.getElementById('exitViewer'),
            fullscreenToggle: document.getElementById('fullscreenToggle'),
            fullImageContainer: document.getElementById('full-image-container'),
            leftArrow: document.getElementById('leftArrow'),
            rightArrow: document.getElementById('rightArrow'),
            lightPollutionOverlay: document.getElementById('lightPollutionMapOverlay'),
            lightPollutionClose: document.getElementById('lightPollutionMapCloseButton'),
            lightPollutionIframe: document.getElementById('lightPollutionMapIframe'),
        };

        this.view3d = new View3D(document.getElementById('gallery-3d'));
        this.view2d = new View2D(document.getElementById('gallery-2d'));

        this.bindEvents();
        this.loadData();
    }

    async loadData() {
        try {
            const response = await fetch('./metadata/metadata.json');
            // If failed, metadata = {}
            if (response.ok) {
                const data = await response.json();
                this.metadata = data;
                this.images = data.image_order || [];
            } else {
                console.warn("Metadata not found, falling back to empty.");
                this.metadata = {};
                this.images = [];
            }

            this.initViews();
            this.typeTitle();
        } catch (e) {
            console.error("Failed to load metadata", e);
            this.images = []; // Should handle graceful failure
            this.initViews();
        }
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
        this.ui.toggle.onclick = () => this.switchMode(this.mode === '3D' ? '2D' : '3D');

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
        this.mode = newMode;
        this.ui.toggle.innerText = newMode === '3D' ? '2D' : '3D';

        if (newMode === '3D') {
            this.view2d.hide();
            this.view3d.show();
            this.view3d.resize(); // Ensure canvas size is correct
            this.view3d.goToIndex(this.currentIndex);

            // Hide 2D-specific overlays if they were open (like fullscreen viewer)
            this.closeFullscreen();
        } else {
            this.view3d.hide();
            this.view2d.show();
            this.view2d.goToIndex(this.currentIndex);
        }
    }

    selectImage(index, openViewer = false) {
        if (index < 0 || index >= this.images.length) return;
        this.currentIndex = index;

        // Sync Views
        if (this.mode === '3D') this.view3d.goToIndex(index);
        else this.view2d.goToIndex(index);

        // Update Metadata
        this.updateMetadata(index);

        // If requested (by 2D click OR 3D active click), open fullscreen viewer
        // Note: Legacy viewer is a 2D overlay, so it works on top of canvas nicely.
        if (openViewer) {
            this.openFullscreenViewer(index);
        } else if (!document.getElementById('imageViewer').hidden) {
            // If viewer is already open, update it
            this.openFullscreenViewer(index);
        }

        // Preload neighbors
        this.preloadImages(index);
    }

    preloadImages(index) {
        const toPreload = [index + 1, index - 1];
        toPreload.forEach(i => {
            if (i >= 0 && i < this.images.length) {
                const imgName = this.images[i];
                const dir = this.useDataSaver ? 'thumbs' : 'fulls';
                const link = document.createElement('link');
                link.rel = 'preload';
                link.as = 'image';
                link.href = `./${dir}/${imgName}.jpg`;
                document.head.appendChild(link);
                // Also JS Image for robust cache
                new Image().src = link.href;
            }
        });
    }

    next() {
        this.selectImage(this.currentIndex + 1);
    }

    prev() {
        this.selectImage(this.currentIndex - 1);
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
    openFullscreenViewer(index) {
        const imgName = this.images[index];
        // Reuse legacy logic: show #imageViewer
        const dir = this.useDataSaver ? 'thumbs' : 'fulls';
        const fullPath = `./${dir}/${imgName}.jpg`;

        this.ui.fullImageContainer.innerHTML = `<div class="loader"></div><img src="${fullPath}" style="transform: translate3d(0,0,0); opacity: 0; transition: opacity 0.3s;" onload="this.style.opacity=1; this.previousElementSibling.remove()">`;
        this.ui.imageViewer.hidden = false;

        // Add minimal load listener for animation
        const img = this.ui.fullImageContainer.querySelector('img');
        if (img.complete) {
            this.ui.imageViewer.classList.add('visible');
        } else {
            img.onload = () => {
                this.ui.imageViewer.classList.add('visible');
            };
        }
        // Fallback
        setTimeout(() => this.ui.imageViewer.classList.add('visible'), 100);
    }

    closeFullscreen() {
        this.ui.imageViewer.classList.remove('visible');
        setTimeout(() => {
            this.ui.imageViewer.hidden = true;
            this.ui.fullImageContainer.innerHTML = '';
        }, 300);
    }

    toggleNativeFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
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
