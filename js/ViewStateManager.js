/**
 * ViewStateManager - Finite State Machine for gallery view modes
 * 
 * States:
 * - EXPLORE: 3D/2D gallery browsing
 * - PREVIEW: Single image fit-to-screen (viewer)
 * - DETAIL: Magnified high-resolution view
 */
export class ViewStateManager {
    constructor() {
        this.states = {
            EXPLORE: 'explore',
            PREVIEW: 'preview',
            DETAIL: 'detail'
        };

        this.currentState = this.states.EXPLORE;

        this.stateHooks = {
            onEnter: {},
            onExit: {}
        };

        this.transitionInProgress = false;
        this.lastTransitionTime = 0;
    }

    /**
     * Attempt to transition to a new state
     * @param {string} newState - Target state
     * @returns {boolean} - Success status
     */
    transition(newState) {
        // Prevent rapid-fire transitions
        const now = Date.now();
        if (now - this.lastTransitionTime < 300) {
            
            return false;
        }

        if (this.transitionInProgress) {
            
            return false;
        }

        if (!this.isValidTransition(this.currentState, newState)) {
            
            return false;
        }

        const previousState = this.currentState;
        this.transitionInProgress = true;
        this.lastTransitionTime = now;

        

        // Execute exit hooks
        if (this.stateHooks.onExit[previousState]) {
            this.stateHooks.onExit[previousState](newState);
        }

        this.currentState = newState;

        // Execute enter hooks
        if (this.stateHooks.onEnter[newState]) {
            this.stateHooks.onEnter[newState](previousState);
        }

        // Allow transitions after current frame completes
        requestAnimationFrame(() => {
            this.transitionInProgress = false;
        });

        return true;
    }

    /**
     * Validate state transition
     */
    isValidTransition(from, to) {
        if (from === to) return false;

        const validTransitions = {
            explore: ['preview'],
            preview: ['explore', 'detail'],
            detail: ['preview', 'explore'] // Allow closing viewer from magnified state
        };

        return validTransitions[from]?.includes(to) ?? false;
    }

    /**
     * Register lifecycle hooks
     * @param {string} state - State name
     * @param {string} hookType - 'onEnter' or 'onExit'
     * @param {Function} callback - Hook function
     */
    registerHook(state, hookType, callback) {
        if (!this.stateHooks[hookType]) {
            
            return;
        }

        this.stateHooks[hookType][state] = callback;
    }

    /**
     * Get current state
     */
    getState() {
        return this.currentState;
    }

    /**
     * Check if in specific state
     */
    is(state) {
        return this.currentState === state;
    }
}
