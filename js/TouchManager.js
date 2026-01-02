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
        }
    }
    handlePinch(prevTouches) {
        if (this.touches.start.length < 2 || !this.initialPinchDist) return;

        const currentDist = this.getDistance(
            this.touches.current[0],
            this.touches.current[1]
        );

        const scale = currentDist / this.initialPinchDist;

        if (this.gestures.onPinch) {
            this.gestures.onPinch(scale, {
                enterThreshold: this.pinchHysteresis.enterThreshold,
                exitThreshold: this.pinchHysteresis.exitThreshold
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
