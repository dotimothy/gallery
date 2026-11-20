import { resolveShape, shapePositions } from './shapes.js';

// Three.js is loaded when the sphere is requested.
let THREE;

export class View3D {
    constructor(container) {
        this.container = container;
        this.camera = null;
        this.scene = null;
        this.renderer = null;
        this.pivot = null;
        this.frames = [];
        this.textureQueue = [];
        this.activeTextureLoads = 0;
        this.images = [];

        // Config
        this.radius = 25;
        this.shapeEmoji = resolveShape(document.querySelector('meta[name="gallery-shape-emoji"]')?.content);
        this.useShape = Boolean(this.shapeEmoji);
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.isDragging = false;
        this.previousMouse = { x: 0, y: 0 };
        this.targetRotation = { x: 0, y: 0 };
        this.currentRotation = { x: 0, y: 0 };
        this.isTransitioning = false; // Flag to disable physics during GSAP anims

        // Time & Stats
        this.clock = null;
        this.frameCount = 0;
        this.lastTime = 0;
        this.fpsElement = document.getElementById('fps-counter');

        // Settings State
        this.sphereSpacing = 10.0;
        this.particleCount = 4800;
        this.sensitivity = 1.0;

        // Rendering Control
        this.isPaused = false;
        this.animationId = null;
    }

    init(images, onSelect, onPreload, isMobile = false, isDebug = false, onMagnify = null) {
        this.onMagnify = onMagnify;
        THREE = window.THREE;
        this.clock = new THREE.Clock();

        this.images = images;
        this.onSelect = onSelect;
        this.onPreload = onPreload;
        this.isMobile = isMobile;
        this.isDebug = isDebug;

        // ... (rest of init) ...

        // 1. SETUP RENDERER
        if (!this.renderer) {
            try {
                this.renderer = new THREE.WebGLRenderer({
                    alpha: true,
                    antialias: !isMobile
                });
            } catch (cause) {
                const error = new Error('Could not create a WebGL renderer', { cause });
                error.name = 'WebGLUnavailableError';
                throw error;
            }
            this.renderer.outputEncoding = THREE.sRGBEncoding;
            this.renderer.toneMapping = THREE.NoToneMapping;
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            // Use stored resolution setting
            this.renderer.setPixelRatio(this.resolution || Math.min(window.devicePixelRatio, 2));
            this.container.innerHTML = ''; // Clear container
            this.container.appendChild(this.renderer.domElement);
        }

        // 2. SETUP SCENE
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050505); // Almost Black

        // 3. SETUP CAMERA
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

        // Config & Mobile Init
        this.baseDistance = 80; // Standard distance
        this.isZoomedIn = false;
        this.camera.position.z = this.baseDistance;

        // 4. LIGHTS REMOVED (Using MeshBasicMaterial for exact color matching)

        // 5. CREATE PIVOT & FRAMES
        this.pivot = new THREE.Group();
        this.scene.add(this.pivot);
        this.createFrames();
        this.createParticles();
        if (this.shapeEmoji && !this.shapeButton) {
            const button = document.createElement('button');
            button.type = 'button';
            button.id = 'shape-toggle';
            button.addEventListener('click', event => {
                event.stopPropagation();
                if (this.layout === 'LINE') return;
                this.useShape = !this.useShape;
                this.applyArrangement(true);
            });
            document.getElementById('gallery-dock').prepend(button);
            this.shapeButton = button;
            this.updateShapeButton();
        }

        // 6. EVENTS
        if (!this.eventsBound) {
            this.bindEvents();
            this.eventsBound = true;
        }

        // 7. START LOOP
        if (!this.isAnimating) {
            this.isAnimating = true;
            this.animate = this.animate.bind(this);
            this.animate();
        }

        if (this.isDebug) console.log(`[View3D] Initialized with ${images.length} images.`);
    }

    createFrames() {
        // Geometry - Use 1x1 plain so we can scale it to exact aspect ratio later
        const geometry = new THREE.PlaneGeometry(1, 1);
        const count = this.images.length;
        const vector = new THREE.Vector3();
        const shape = this.useShape ? shapePositions(this.shapeEmoji, count, Math.max(25, this.sphereSpacing * Math.sqrt(count))) : [];

        // Dynamic Radius: Expand sphere based on image count
        // sqrt(N) ensures constant surface density
        // Dynamic Radius: Expand sphere based on image count
        // sqrt(N) ensures constant surface density
        // Min radius 25, scaling factor from settings (default 6)
        this.radius = Math.max(25, this.sphereSpacing * Math.sqrt(count));

        // Update initial camera distance immediately so it's ready
        this.baseDistance = this.getOptimalDistance();
        this.camera.position.z = this.baseDistance;

        for (let i = 0; i < count; i++) {
            // Fibonacci Sphere Algorithm (Standard)
            const phi = Math.acos(-1 + (2 * i) / count);
            const theta = Math.sqrt(count * Math.PI) * phi;

            // Fit the layout shape to the device aspect ratio (Ellipsoid/Oval)
            // On mobile portrait, height is ~2x width. We stretch the "sphere" into an oval.
            const aspect = window.innerWidth / window.innerHeight;
            const stretch = aspect < 1 ? (1 / aspect) * 0.8 : 1.0;

            const x = this.radius * Math.cos(theta) * Math.sin(phi);
            const y = this.radius * Math.sin(theta) * Math.sin(phi) * stretch;
            const z = this.radius * Math.cos(phi);

            // Material - Start with a Color so we SEE it even if texture fails
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff, // Use white as base so texture isn't tinted
                side: THREE.DoubleSide,
                transparent: true // In case we want to fade them in/out later
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(...(shape[i] || [x, y, z]));

            // Set initial scale to placeholders
            mesh.scale.set(5, 3.5, 1);

            // Orient: Look AWAY from center
            // For an oval, looking exactly away from center keeps images flat to the viewer 
            // when they are at the center of the viewport.
            vector.copy(mesh.position);
            // We want them to point slightly more "outward" but maintain a pleasant curve
            if (!this.useShape) mesh.lookAt(vector.x * 2, vector.y * 2, vector.z * 2);

            mesh.userData = { index: i, originalPos: mesh.position.clone(), originalQuaternion: mesh.quaternion.clone() };
            this.pivot.add(mesh);
            this.frames.push(mesh);

            this.textureQueue.push({ mesh, image: this.images[i] });
        }
        this.loadQueuedTextures();
    }

    loadQueuedTextures() {
        while (this.activeTextureLoads < 3 && this.textureQueue.length) {
            const { mesh, image } = this.textureQueue.shift();
            if (mesh.parent !== this.pivot) continue;

            this.activeTextureLoads++;
            const finish = () => {
                this.activeTextureLoads--;
                this.loadQueuedTextures();
            };

            new THREE.TextureLoader().load(`./thumbs/${image}.jpg`, (texture) => {
                if (mesh.parent === this.pivot) {
                    texture.encoding = THREE.sRGBEncoding;
                    texture.minFilter = THREE.LinearFilter;
                    const height = this.isMobile ? 8 : 5;
                    const aspect = texture.image.width / texture.image.height;
                    // Keep panoramic frames from covering nearby photos in emoji layouts.
                    const fit = this.shapeEmoji ? Math.min(1, 9 / (height * aspect)) : 1;
                    mesh.scale.set(height * aspect * fit, height * fit, 1);
                    mesh.material.map = texture;
                    mesh.material.needsUpdate = true;
                } else {
                    texture.dispose();
                }
                finish();
            }, undefined, finish);
        }
    }

    updateShapeButton() {
        if (!this.shapeButton) return;
        this.shapeButton.textContent = this.useShape ? 'View Sphere' : `View ${this.shapeEmoji} Shape`;
        this.shapeButton.setAttribute('aria-label', this.shapeButton.textContent);
        this.shapeButton.hidden = this.layout === 'LINE' || this.container.style.display === 'none';
    }

    applyArrangement(animate = false) {
        const count = this.frames.length;
        const shape = this.useShape ? shapePositions(this.shapeEmoji, count, this.radius) : [];
        const aspect = window.innerWidth / window.innerHeight;
        const stretch = aspect < 1 ? (1 / aspect) * .8 : 1;
        const duration = animate && !this.reducedMotion ? .8 : 0;
        gsap.killTweensOf(this.pivot.rotation);
        this.isTransitioning = false;
        this.targetRotation = {x: 0, y: 0};
        this.currentRotation = {x: 0, y: 0};
        this.pivot.rotation.set(0, 0, 0);
        this.frames.forEach((mesh, i) => {
            const phi = Math.acos(-1 + 2 * i / count), theta = Math.sqrt(count * Math.PI) * phi;
            const position = new THREE.Vector3(...(shape[i] || [
                this.radius * Math.cos(theta) * Math.sin(phi),
                this.radius * Math.sin(theta) * Math.sin(phi) * stretch,
                this.radius * Math.cos(phi)]));
            const target = new THREE.Object3D();
            target.position.copy(position);
            if (!this.useShape) target.lookAt(position.clone().multiplyScalar(2));
            mesh.userData.originalPos = position;
            mesh.userData.originalQuaternion = target.quaternion.clone();
            gsap.to(mesh.position, {x: position.x, y: position.y, z: position.z, duration, overwrite: true});
            gsap.to(mesh.quaternion, {x: target.quaternion.x, y: target.quaternion.y, z: target.quaternion.z, w: target.quaternion.w, duration, overwrite: true});
        });
        this.baseDistance = this.getOptimalDistance();
        this.isZoomedIn = false;
        gsap.to(this.camera.position, {z: this.baseDistance, duration, overwrite: true});
        this.updateShapeButton();
    }

    createParticles() {
        this.particleGroup = new THREE.Group();
        this.scene.add(this.particleGroup);

        const createSystem = (count, size, opacity) => {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);

            for (let i = 0; i < count; i++) {
                const r = 400 + Math.random() * 800; // Distance 400-1200
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos((Math.random() * 2) - 1);

                positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
                positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
                positions[i * 3 + 2] = r * Math.cos(phi);
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const material = new THREE.PointsMaterial({
                color: 0xffffff,
                size: size,
                transparent: true,
                opacity: opacity,
                sizeAttenuation: true
            });

            const points = new THREE.Points(geometry, material);
            this.particleGroup.add(points);
        };

        // 1. Dust (Small, many) - 80% of total
        createSystem(Math.floor(this.particleCount * 0.8), 1.2, 0.4);

        // 2. Stars (Larger, fewer) - 20% of total
        createSystem(Math.floor(this.particleCount * 0.2), 2.5, 0.8);
    }

    getOptimalDistance() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const aspect = width / height;

        // Scientific base: To fit a sphere vertically in 60deg FOV:
        // dist = radius / tan(30deg) = radius / 0.577 ~= 1.73 * radius.
        // We use 2.3 as base for comfortable padding.
        let baseMultiplier = 2.3;
        let multiplier = baseMultiplier;

        // If in Portrait mode (Aspect < 1), the horizontal width is the constraint.
        // We must scale the distance by 1/aspect to keep the sphere within sideways bounds.
        if (aspect < 1) {
            multiplier = baseMultiplier / aspect;
        }

        // Add a small extra bump if the detection specifically says it's a mobile device UA
        if (this.isMobile) multiplier *= 1.1;

        if (this.useShape) {
            // Fit a bounding sphere including photo corners at any orbit angle.
            const halfFov = Math.atan(Math.tan(Math.PI / 6) * Math.min(1, aspect));
            return (this.radius * 1.45 + 10) / Math.sin(halfFov);
        }
        return this.radius * Math.min(7, multiplier);
    }

    getResponsiveLineDistance(index) {
        if (!this.frames[index]) return 6; // Fallback

        // 1. Get Image dimensions in World Space
        const mesh = this.frames[index];
        const imgWidth = mesh.scale.x;
        // height is always 5 based on loader logic

        // 2. Camera params
        // Vertical FOV in radians
        const vFOV = (this.camera.fov * Math.PI) / 180;

        // 3. Calculate distance to fit WIDTH
        // FrustumWidth = 2 * dist * tan(vFOV/2) * aspect
        // We want FrustumWidth >= imgWidth
        // dist = imgWidth / (2 * tan(vFOV/2) * aspect)

        // Add minimal padding (1.1x) to avoid edge touching
        const padding = 1.1;
        const requiredDistForWidth = (imgWidth * padding) / (2 * Math.tan(vFOV / 2) * this.camera.aspect);

        // 4. Calculate distance to fit HEIGHT (just in case)
        // FrustumHeight = 2 * dist * tan(vFOV/2)
        // dist = imgHeight / (2 * tan(vFOV/2))
        const requiredDistForHeight = (mesh.scale.y * padding) / (2 * Math.tan(vFOV / 2));

        // 5. Use the max distance to ensure BOTH fit (Contain logic)
        // User specifically asked for "width fits", which usually implies ensuring width is visible.
        // If we strictly follow "width fits", we might cut off height on very wide screens?
        // No, standard "contain" uses max distance.
        // Let's stick to "Contain" which satisfies "width fits" implicitly.

        // However, if the user meant "Cover" (zoom until width fills, potentially cropping height)?
        // "width of the image fits on the users scren" -> "Width matches Screen Width"
        // This is exactly `requiredDistForWidth`.

        // Let's use `requiredDistForWidth` as the primary driver, 
        // but clamped to a reasonable minimum (don't go too close than 5).
        return Math.max(5, requiredDistForWidth);
    }

    bindEvents() {
        const threshold = this.isMobile ? 12 : 5; // Higher threshold for mobile
        let startPos = { x: 0, y: 0 };
        let totalDist = 0;

        const onDown = (x, y) => {
            if (this.layout === 'LINE') return;
            this.isPressed = true;
            this.isDragging = false;
            startPos = { x, y };
            this.previousMouse = { x, y };
            totalDist = 0;
        };

        const onMove = (x, y) => {
            if (this.isPressed) {
                const deltaX = x - this.previousMouse.x;
                const deltaY = y - this.previousMouse.y;

                totalDist += Math.sqrt(deltaX * deltaX + deltaY * deltaY);

                // Only start rotating if we've moved enough (prevents tap jitter)
                if (totalDist > threshold) {
                    this.isDragging = true;
                }

                if (this.isDragging) {
                    // Reduce sensitivity significantly on mobile, but user asked for more (Request 3)
                    // Old: 0.002, New: 0.003
                    // Sensitivity Setting Applied Here
                    const speed = (this.isMobile ? 0.003 : 0.004) * this.sensitivity;
                    this.targetRotation.y += deltaX * speed;
                    this.targetRotation.x += deltaY * speed;
                }

                this.previousMouse = { x, y };
            }
        };

        const onUp = () => {
            this.isPressed = false;
            // Delay resetting isDragging so the 'click' event can still catch it
            setTimeout(() => {
                this.isDragging = false;
            }, 50);
            this.previousPinchDist = 0; // Reset pinch
        };

        // Zoom Handler
        const handleZoom = (delta) => {
            if (this.isZoomedIn) return; // Don't interfere with transition

            // Auto-Magnify Logic
            // If delta < 0 (zooming in) and we are already near minZ in LINE layout
            if (this.layout === 'LINE' && delta < 0 && this.onMagnify) {
                // Disable auto-zoom-to-immersive on mobile (User Request 2)
                if (this.isMobile) return;

                const responsiveDist = this.getResponsiveLineDistance(this.currentIndex);
                // Trigger magnifier when we get very close
                if (this.camera.position.z < responsiveDist * 1.02) {
                    this.onMagnify();
                    return;
                }
            }

            const zoomSpeed = 0.5 * this.sensitivity;
            let newZ = this.camera.position.z + delta * zoomSpeed;

            // Clamp Zoom
            // In LINE layout, allow getting much closer
            const responsiveDist = this.getResponsiveLineDistance(this.currentIndex);
            const minZ = this.layout === 'LINE' ? responsiveDist * 0.9 : this.radius * 1.5;
            const maxZ = this.getOptimalDistance() * 2; // Allow backing out 2x default

            newZ = Math.max(minZ, Math.min(newZ, maxZ));

            this.camera.position.z = newZ;
            // Update baseDistance so resize doesn't snap it back immediately
            this.baseDistance = newZ;
        };

        // Mouse Events
        this.container.addEventListener('mousedown', e => onDown(e.clientX, e.clientY));
        window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
        window.addEventListener('mouseup', onUp);

        // Wheel Zoom
        this.container.addEventListener('wheel', e => {
            // Prevent page scroll only if over canvas
            e.preventDefault();
            handleZoom(Math.sign(e.deltaY) * 5); // 5 units per tick
        }, { passive: false });

        // Touch Events (Swipe + Pinch)
        this.previousPinchDist = 0;

        this.container.addEventListener('touchstart', e => {
            if (e.touches.length === 1) {
                onDown(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                this.previousPinchDist = Math.sqrt(dx * dx + dy * dy);
                this.isPressed = false; // Pinch overrides drag
                this.isDragging = false;
            }
        }, { passive: false });

        window.addEventListener('touchmove', e => {
            if (e.touches.length === 1) {
                onMove(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length === 2) {
                e.preventDefault(); // Prevent browser zoom
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (this.previousPinchDist > 0) {
                    const delta = this.previousPinchDist - dist; // + means pinching IN (shrinking fingers) -> Zoom OUT (camera Z increase)
                    // Sensitivity
                    handleZoom(delta * 0.2); // Reduced from 0.5 for smoother mobile experience
                }
                this.previousPinchDist = dist;
            }
        }, { passive: false });

        window.addEventListener('touchend', onUp);

        // Click / Select logic ... (raycaster) -- REMAINING CODE BELOW --
        this.raycaster = new THREE.Raycaster();
        this.container.addEventListener('click', (e) => {
            if (this.isDragging) return; // Ignore drag-clicks

            // Normalize mouse
            const mouse = new THREE.Vector2(
                (e.clientX / window.innerWidth) * 2 - 1,
                -(e.clientY / window.innerHeight) * 2 + 1
            );

            this.raycaster.setFromCamera(mouse, this.camera);
            const intersects = this.raycaster.intersectObjects(this.pivot.children);

            if (intersects.length > 0) {
                const idx = intersects[0].object.userData.index;

                // NEW: If we are already centered on this image in LINE mode, a click should zoom in (Magnifier)
                if (this.layout === 'LINE' && idx === this.currentIndex) {
                    if (this.onMagnify) this.onMagnify();
                } else {
                    this.selectIndex(idx);
                }
            }
        });

        // Resize
        window.addEventListener('resize', () => this.resize());
    }



    enterLineView(targetIndex) {
        this.layout = 'LINE';
        this.updateShapeButton();
        this.currentIndex = targetIndex;
        this.isTransitioning = true; // Disable physics during layout change

        // 1. Reset Pivot Rotation to Identity (Straight line)
        // SMART FIX: Animate to NEAREST multiple of 2PI for Y axis to avoid huge "unwind" spins.
        const PI2 = Math.PI * 2;
        const currentY = this.pivot.rotation.y;
        const targetY = Math.round(currentY / PI2) * PI2;

        this.targetRotation = { x: 0, y: targetY };
        this.currentRotation = { x: 0, y: targetY };

        gsap.to(this.pivot.rotation, {
            x: 0,
            y: targetY,
            z: 0,
            duration: 0.8,
            ease: "power2.out",
            onComplete: () => {
                this.isTransitioning = false; // Layout change done
            }
        });

        // 2. Animate Camera to a good viewing distance for simple line
        const lineDist = this.getResponsiveLineDistance(targetIndex);
        gsap.to(this.camera.position, { z: lineDist, duration: 0.8, ease: "power2.out" });

        // 3. Move all frames to Line positions
        const spacing = 12; // Gap between frames

        this.frames.forEach((mesh, i) => {
            // Target is at 0. Others are offset relative to target.
            const offset = i - targetIndex;
            const targetX = offset * spacing;
            const targetY = 0;
            const targetZ = 0; // Flat line

            gsap.to(mesh.position, {
                x: targetX,
                y: targetY,
                z: targetZ,
                duration: 0.8,
                ease: "power2.out"
            });

            // Rotate frames to face forward (0,0,1 direction)
            // Use Quaternion for smooth shortest-path rotation
            gsap.to(mesh.quaternion, {
                x: 0,
                y: 0,
                z: 0,
                w: 1, // Identity Quaternion (Face Z+)
                duration: 0.8,
                ease: "power2.out"
            });
        });
    }

    exitLineView() {
        if (this.layout !== 'LINE') return;
        this.layout = 'SPHERE';
        this.applyArrangement(true);
    }

    selectIndex(index) {
        if (!this.frames[index]) return;
        this.currentIndex = index;
        if (this.onPreload) this.onPreload(index);

        // DIRECT HANDOFF: We skip 'zoomAndSelect' because it tilts the sphere,
        // which conflicts with 'enterLineView' (which requires an upright sphere).
        // relying on 'enterLineView' to handle the entire animation (uprighting + centering)
        // is much smoother and consistent.
        this.onSelect(index, true);
    }

    goToIndex(index) {
        if (this.frames[index]) {
            this.currentIndex = index;
            // Optional: Rotate to face it?
            // For now just update state to avoid crash
        }
    }

    animate() {
        if (this.isPaused) return;

        // Time
        const dt = this.clock.getDelta();
        const time = this.clock.elapsedTime;

        // FPS Calculation
        this.frameCount++;
        if (time >= this.lastTime + 1.0) {
            const fps = Math.round((this.frameCount * 1.0) / (time - this.lastTime));
            if (this.fpsElement) this.fpsElement.innerText = `FPS: ${fps}`;
            this.frameCount = 0;
            this.lastTime = time;
        }

        // Smooth Rotation Inertia (Time-based Damping)
        // Only apply in SPHERE mode and if NOT transitioning (GSAP control)
        if (this.layout !== 'LINE' && !this.isTransitioning) {
            // Lerp factor independent of framerate: 1 - exp(-speed * dt)
            // Increased damping for mobile (lower speed factor)
            const speedFactor = this.isMobile ? 6.0 : 10.0;
            const smoothFactor = 1.0 - Math.exp(-speedFactor * dt);

            this.currentRotation.x += (this.targetRotation.x - this.currentRotation.x) * smoothFactor;
            this.currentRotation.y += (this.targetRotation.y - this.currentRotation.y) * smoothFactor;

            this.pivot.rotation.x = this.currentRotation.x;
            this.pivot.rotation.y = this.currentRotation.y;
        }

        // Auto Rotate
        if (!this.isDragging && !this.isTransitioning && !this.useShape && !this.reducedMotion && this.layout !== 'LINE') {
            // Speed should be "per second" now if using dt, but targetRotation is position accumulator
            // Original: += 0.0005 per frame. At 60fps -> 0.03 per second.
            this.targetRotation.y += 0.03 * dt;
        }

        // Animate Particles
        if (this.particleGroup) {
            this.particleGroup.rotation.y += 0.024 * dt; // Original 0.0004 * 60
            this.particleGroup.rotation.x += 0.006 * dt; // Original 0.0001 * 60
        }

        this.renderer.render(this.scene, this.camera);
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    pauseRendering() {
        this.isPaused = true;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        console.log('[View3D] Rendering paused');
    }

    resumeRendering() {
        if (!this.isPaused) return;
        this.isPaused = false;
        this.clock.getDelta(); // Reset delta to avoid huge jump
        this.animate();
        console.log('[View3D] Rendering resumed');
    }

    resize() {
        if (!this.camera || !this.renderer) return;
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);

        // Mobile Fit Logic (Aggressive)
        // Recalculate based on current dynamic radius
        this.baseDistance = this.getOptimalDistance();

        if (this.layout === 'LINE' && this.frames[this.currentIndex]) {
            // In line mode, resize should update distance to maintain "fit"
            const dist = this.getResponsiveLineDistance(this.currentIndex);
            this.camera.position.z = dist;
        } else if (!this.isZoomedIn) {
            this.camera.position.z = this.baseDistance;
        }
    }

    updateSettings(key, value) {
        if (this.isDebug) console.log(`[View3D] Update ${key}: ${value}`);

        if (key === 'resolution') {
            this.resolution = value;
            if (this.renderer) this.renderer.setPixelRatio(value);
        }

        if (key === 'sphereSpacing') {
            this.sphereSpacing = value;
            if (this.pivot) {
                // Re-create frames to adjust radius
                // We need to clear old frames first
                this.frames.forEach(f => {
                    this.pivot.remove(f);
                    if (f.geometry) f.geometry.dispose();
                    if (f.material) {
                        if (f.material.map) f.material.map.dispose();
                        f.material.dispose();
                    }
                });
                this.frames = [];
                this.textureQueue = [];
                this.createFrames();
                if (this.layout === 'LINE') this.enterLineView(this.currentIndex);
            }
        }

        if (key === 'particleCount') {
            this.particleCount = value;
            if (this.scene) {
                if (this.particleGroup) {
                    this.scene.remove(this.particleGroup);
                    this.particleGroup.traverse(c => {
                        if (c.geometry) c.geometry.dispose();
                        if (c.material) c.material.dispose();
                    });
                    this.particleGroup = null;
                }
                this.createParticles();
            }
        }

        if (key === 'sensitivity') {
            this.sensitivity = value;
        }
    }

    show() {
        this.container.style.display = 'block';
        this.updateShapeButton();
        this.resize();
        this.resumeRendering();
    }
    hide() {
        this.container.style.display = 'none';
        this.updateShapeButton();
    }
}
