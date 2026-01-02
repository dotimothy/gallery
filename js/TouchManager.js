/**
 * TouchManager - Unified touch event handler with gesture detection
 * 
 * Gestures:
 * - Single tap
 * - Pinch (with hysteresis)
 * - Pan
 * - Pull-down to dismiss
 */
export class TouchManager {
    constructor(element) {
        this.element = element;

        this.touches = {
            start: [],
            current: [],
            startTime: 0
        };

        this.gestures = {
            onTap: null,
            onPinch: null,
            onPan: null,
            onPullDown: null
        };

        // Hysteresis prevents flickering between zoom states
        this.pinchHysteresis = {
            enterThreshold: 1.15,   // Must scale 15% to enter zoom
            exitThreshold: 1.03     // Only needs 3% to exit (asymmetric)
        };

        this.panThreshold = 10; // Minimum movement to register as pan
        this.tapTimeout = 300;  // Max time for tap
        this.pullDownThreshold = 100; // Vertical pull distance to trigger dismiss

        this.isPanning = false;
        this.initialPinchDist = 0;
        this.currentScale = 1;

        this.bindEvents();
    }

    bindEvents() {
        this.element.addEventListener('touchstart', (e) => {
            this.touches.start = Array.from(e.touches).map(t => ({
                x: t.clientX,
                y: t.clientY,
                id: t.identifier
            }));
            this.touches.current = [...this.touches.start];
            this.touches.startTime = Date.now();
            this.isPanning = false;

            if (e.touches.length === 2) {
                this.initialPinchDist = this.getDistance(
                    this.touches.start[0],
                    this.touches.start[1]
                );
            }
        }, { passive: false });

        this.element.addEventListener('touchmove', (e) => {
            e.preventDefault();

            const prevTouches = [...this.touches.current];
            this.touches.current = Array.from(e.touches).map(t => ({
                x: t.clientX,
                y: t.clientY,
                id: t.identifier
            }));

            this.detectGesture(prevTouches);
        }, { passive: false });

        this.element.addEventListener('touchend', (e) => {
            if (this.isPanning && this.gestures.onPan) {
                this.gestures.onPan(0, 0, 'end');
            }
            // MODIFIED: Pass correct Y value on end
            if (this.isPullingDown && this.gestures.onPullDown) {
                const finalTouch = e.changedTouches[0];
                const startTouch = this.touches.start[0];
                if (finalTouch && startTouch) {
                    const totalY = finalTouch.clientY - startTouch.y;
                    this.gestures.onPullDown(totalY, 'end');
                } else {
                    this.gestures.onPullDown(0, 'end'); // Fallback
                }
            }

            this.handleGestureEnd();

            if (e.touches.length === 0) {
                this.resetTouchState();
            }
        });
    }

    resetTouchState() {
        this.touches.start = [];
        this.touches.current = [];
        this.isPanning = false;
        this.isPullingDown = false;
        this.initialPinchDist = 0;
    }

    detectGesture(prevTouches) {
        if (this.touches.current.length === 2 && prevTouches.length === 2) {
            this.handlePinch(prevTouches);
        } else if (this.touches.current.length === 1 && prevTouches.length === 1) {
            this.handleSingleTouch(prevTouches);
        }
    }

    handleSingleTouch(prevTouches) {
        const current = this.touches.current[0];
        const start = this.touches.start[0];
        const prev = prevTouches[0];

        const totalX = current.x - start.x;
        const totalY = current.y - start.y;
        const deltaX = current.x - prev.x;
        const deltaY = current.y - prev.y;

        // 1. Determine if this is a vertical Pull-Down to dismiss
        // We trigger this if the movement is primarily downward and we aren't already panning
        if (!this.isPanning && totalY > this.panThreshold && Math.abs(totalY) > Math.abs(totalX)) {
            this.isPullingDown = true;
            if (this.gestures.onPullDown) {
                this.gestures.onPullDown(totalY, 'move');
            }
        }
        // 2. Otherwise, treat it as a standard Pan (for moving zoomed images)
        else if (!this.isPullingDown && (Math.abs(totalX) > this.panThreshold || Math.abs(totalY) > this.panThreshold)) {
            if (!this.isPanning) {
                this.isPanning = true;
                if (this.gestures.onPan) this.gestures.onPan(0, 0, 'start');
            }
            if (this.gestures.onPan) {
                this.gestures.onPan(deltaX, deltaY, 'move');
            }
        }
    }
    handlePinch(prevTouches) {
        if (this.touches.start.length < 2 || !this.initialPinchDist) return;

        // Calculate distance in the PREVIOUS frame
        const prevDist = this.getDistance(prevTouches[0], prevTouches[1]);

        // Calculate distance in the CURRENT frame
        const currentDist = this.getDistance(
            this.touches.current[0],
            this.touches.current[1]
        );

        // Calculate scale relative to the previous frame (The Delta)
        const frameScale = currentDist / prevDist;

        // Calculate the total cumulative scale relative to the start
        const totalScale = currentDist / this.initialPinchDist;

        if (this.gestures.onPinch) {
            this.gestures.onPinch(totalScale, {
                enterThreshold: this.pinchHysteresis.enterThreshold,
                exitThreshold: this.pinchHysteresis.exitThreshold,
                frameScale: frameScale // <--- Pass this to app.js
            });
        }
    }

    handleGestureEnd() {
        const duration = Date.now() - this.touches.startTime;

        if (!this.isPanning && !this.isPullingDown && duration < this.tapTimeout && this.touches.start.length === 1) {
            if (this.gestures.onTap) {
                this.gestures.onTap(this.touches.start[0]);
            }
        }
    }

    getDistance(touch1, touch2) {
        const dx = touch1.x - touch2.x;
        const dy = touch1.y - touch2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Register gesture callback
     * @param {string} type - 'onTap', 'onPinch', 'onPan', 'onPullDown'
     * @param {Function} callback
     */
    registerGesture(type, callback) {
        if (!this.gestures.hasOwnProperty(type)) {
            console.error(`Invalid gesture type: ${type}`);
            return;
        }
        this.gestures[type] = callback;
    }

    /**
     * Update hysteresis thresholds
     */
    setHysteresis(enter, exit) {
        this.pinchHysteresis.enterThreshold = enter;
        this.pinchHysteresis.exitThreshold = exit;
    }

    /**
     * Cleanup
     */
    destroy() {
        // Remove event listeners if needed
        this.gestures = {
            onTap: null,
            onPinch: null,
            onPan: null,
            onPullDown: null
        };
    }
}
