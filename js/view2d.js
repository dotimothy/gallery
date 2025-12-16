export class View2D {
    constructor(container) {
        this.container = container;
        this.images = [];
        this.onSelect = null;
    }

    init(images, onSelect, isDebug = false) {
        this.isDebug = isDebug;
        if (this.isDebug) console.log(`[View2D] Init: ${images.length} images`);
        this.images = images;
        this.onSelect = onSelect;
        // set default or initial from somewhere? App will call updateSettings on load potentially.
        // But let's support it if we want. For now, App handles the initial sync.
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

            const img = document.createElement('img');
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = `./thumbs/${imgName}.jpg`;
            img.alt = `Photo ${index}`;
            img.onerror = (e) => {
                console.error(`Failed to load thumb: ${img.src}`);
                thumb.style.backgroundColor = 'red'; // Visual debug
            };

            thumb.appendChild(img);

            thumb.onclick = () => {
                if (this.onSelect) this.onSelect(index, true);
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
