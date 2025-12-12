
export class View2D {
    constructor(container) {
        this.container = container;
        this.initialized = false;
        this.thumbs = [];
        this.currentIndex = -1;
    }

    init(images, onSelect) {
        this.images = images;
        this.onSelect = onSelect;
        this.container.innerHTML = '';
        this.thumbs = []; // Clear old references

        // Build Grid
        this.images.forEach((imgName, index) => {
            const thumb = document.createElement('div');
            thumb.className = 'thumb';
            // Restored loading="lazy" for performance.
            // Added decoding="async" to unblock main thread.
            // Kept placeholder background.
            thumb.style.backgroundColor = '#111';
            thumb.innerHTML = `<img src="./thumbs/${imgName}.jpg" loading="lazy" decoding="async" alt="${imgName}" onerror="this.style.display='none'">`;
            thumb.onclick = () => this.onSelect(index, true); // true = open viewer
            this.container.appendChild(thumb);
            this.thumbs.push(thumb);
        });

        // Add padding at bottom for footer/ui
        const spacer = document.createElement('div');
        spacer.style.height = "100px";
        spacer.style.width = "100%";
        this.container.appendChild(spacer);

        this.initialized = true;
    }

    show() {
        this.container.classList.add('active');
    }

    hide() {
        this.container.classList.remove('active');
    }

    goToIndex(index) {
        if (this.currentIndex === index) return;

        // Remove old active
        if (this.thumbs[this.currentIndex]) {
            this.thumbs[this.currentIndex].classList.remove('active');
        }

        this.currentIndex = index;

        // Add new active
        if (this.thumbs[index]) {
            this.thumbs[index].classList.add('active');

            // Allow browser layout to settle if coming from hidden
            setTimeout(() => {
                this.thumbs[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 50);
        }
    }
}
