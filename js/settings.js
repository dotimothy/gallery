export class SettingsManager {
    constructor(onUpdate, isMobile = false) {
        this.onUpdate = onUpdate;

        const desktopDefaults = {
            resolution: 1.0,      // 0.25 - 3.0
            sphereSpacing: 2.0,   // 1.0 - 15.0
            particleCount: 50000, // 0 - 50000
            gridColumns: 5,        // 1 - 10
            slideshowInterval: 3.0 // Seconds
        };

        const mobileDefaults = {
            resolution: 1.0,      // Performance
            sphereSpacing: 1.0,   // 1.0 - 15.0
            particleCount: 25000,  // Reduced for mobile GPU
            gridColumns: 2,       // 1 - 10
            slideshowInterval: 3.0 // Seconds
        };

        this.defaults = isMobile ? mobileDefaults : desktopDefaults;
        this.settings = { ...this.defaults };

        // Debug
        this.isDebug = new URLSearchParams(window.location.search).has('debug');

        this.load();
    }

    load() {
        const stored = sessionStorage.getItem('gallerySettings');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                this.settings = { ...this.defaults, ...parsed }; // Merge to ensure new keys exist
                if (this.isDebug) console.log("[Settings] Loaded:", this.settings);
            } catch (e) {
                console.warn("Failed to parse settings", e);
            }
        }
    }

    save() {
        sessionStorage.setItem('gallerySettings', JSON.stringify(this.settings));
        if (this.isDebug) console.log("[Settings] Saved:", this.settings);
    }

    get(key) {
        return this.settings[key];
    }

    set(key, value) {
        this.settings[key] = value;
        this.save();
        if (this.onUpdate) this.onUpdate(key, value);
    }

    reset() {
        this.settings = { ...this.defaults };
        this.save();
        if (this.onUpdate) {
            // notify all
            Object.keys(this.settings).forEach(k => this.onUpdate(k, this.settings[k]));
        }
        if (this.isDebug) console.log("[Settings] Reset to defaults");
    }
}
