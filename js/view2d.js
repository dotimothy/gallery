export class View2D {
    constructor(container) {
        this.container = container;
        this.images = [];
        this.onSelect = null;
    }

    init(images, onSelect, metadata = {}, isDebug = false) {
        this.isDebug = isDebug;
        if (this.isDebug) console.log(`[View2D] Init: ${images.length} images`);
        this.images = images;
        this.onSelect = onSelect;
        this.metadata = metadata;
        this.render();
    }

    render() {
        if (this.isDebug) console.log("[View2D] Rendering grid...");
        this.container.innerHTML = '';
        if (this.images.length === 0) {
            if (this.isDebug) console.warn("View2D: No images to render!");
            this.container.innerHTML = '<p style="color:white;text-align:center;">No images found.</p>';
            return;
        }
        this.images.forEach((imgName, index) => {
            const thumb = document.createElement('div');
            thumb.className = 'thumb';
            thumb.tabIndex = 0;
            thumb.setAttribute('role', 'button');

            const meta = this.metadata[imgName];
            const w = meta && meta['Image Width'];
            const h = meta && meta['Image Height'];
            if (w && h) thumb.style.aspectRatio = `${w} / ${h}`;

            if (meta && meta.lqip) {
                thumb.style.backgroundImage = `url(${meta.lqip})`;
                thumb.style.backgroundSize = 'cover';
                thumb.style.backgroundPosition = 'center';
            }

            const img = document.createElement('img');
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = `./thumbs/${imgName}.jpg`;
            const altParts = [meta && meta['Image Model'], meta && meta['EXIF FocalLength'], meta && meta['EXIF DateTimeOriginal']].filter(Boolean);
            img.alt = altParts.length ? altParts.join(' — ') : `Photo ${index + 1}`;

            const revealThumb = () => {
                thumb.classList.add('loaded');
            };
            img.addEventListener('load', revealThumb);
            // Handle images already in browser cache (load event won't fire)
            if (img.complete && img.naturalWidth > 0) revealThumb();

            img.onerror = () => {
                console.error(`Failed to load thumb: ${img.src}`);
                thumb.style.backgroundImage = '';
                thumb.classList.add('loaded');
            };

            thumb.appendChild(img);

            thumb.onclick = () => {
                if (this.onSelect) this.onSelect(index, true);
            };
            thumb.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (this.onSelect) this.onSelect(index, true);
                }
            };

            this.container.appendChild(thumb);
        });

        // Add footer spacer
        const spacer = document.createElement('div');
        spacer.style.width = '100%';
        spacer.style.height = '100px';
        this.container.appendChild(spacer);
    }

    goToIndex(index) {
        // Highlight active thumbnail
        const thumbs = this.container.getElementsByClassName('thumb');
        for (let i = 0; i < thumbs.length; i++) {
            if (thumbs[i]) thumbs[i].classList.toggle('active', i === index);
        }

        if (thumbs[index]) {
            thumbs[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    show() {
        this.container.classList.add('active');
        this.container.classList.remove('hidden'); // Just in case
    }

    updateSettings(key, value) {
        if (key === 'gridColumns') {
            if (this.isDebug) console.log(`[View2D] Update gridColumns: ${value}`);
            this.container.style.setProperty('--col-count', value);
        }
    }

    hide() {
        this.container.classList.remove('active');
        this.container.classList.add('hidden');
    }
}
