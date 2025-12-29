
// Three.js is loaded globally via CDN
const THREE = window.THREE;

export class View3D {
    constructor(container) {
        this.container = container;
        this.camera = null;
        this.scene = null;
        this.renderer = null;
        this.pivot = null;
        this.frames = [];
        this.images = [];

        // Config
        this.radius = 25;
        this.isDragging = false;
        this.previousMouse = { x: 0, y: 0 };
        this.targetRotation = { x: 0, y: 0 };
        this.currentRotation = { x: 0, y: 0 };

        // Time & Stats
        this.clock = new THREE.Clock();
        this.frameCount = 0;
        this.lastTime = 0;
        this.fpsElement = document.getElementById('fps-counter');

        // Settings State
        this.sphereSpacing = 6.0;
        this.particleCount = 4800;
    }

    init(images, onSelect, onPreload, isDebug = false) {
        if (!THREE) {
            console.error("Three.js not loaded");
            return;
        }

        this.images = images;
        this.onSelect = onSelect;
        this.onPreload = onPreload;
        this.isDebug = isDebug;

        // ... (rest of init) ...

        // 1. SETUP RENDERER
        if (!this.renderer) {
            this.renderer = new THREE.WebGLRenderer({
                alpha: true,
                antialias: true,
                powerPreference: "high-performance"
            });
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

        // 4. ADD LIGHTS
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(50, 50, 100);
        this.scene.add(dirLight);

        // 5. CREATE PIVOT & FRAMES
        this.pivot = new THREE.Group();
        this.scene.add(this.pivot);
        this.createFrames();
        this.createParticles();

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

            const x = this.radius * Math.cos(theta) * Math.sin(phi);
            const y = this.radius * Math.sin(theta) * Math.sin(phi);
            const z = this.radius * Math.cos(phi);

            // Material - Start with a Color so we SEE it even if texture fails
            const material = new THREE.MeshStandardMaterial({
                color: 0xcccccc,
                side: THREE.DoubleSide
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(x, y, z);

            // Set initial scale to "Square" placeholders of reasonable size (5x5)
            // or 5x3.5 to match old default look before load
            mesh.scale.set(5, 3.5, 1);

            // Orient: Look AWAY from center
            vector.copy(mesh.position).multiplyScalar(2);
            mesh.lookAt(vector);

            mesh.userData = { index: i, originalPos: mesh.position.clone() };
            this.pivot.add(mesh);
            this.frames.push(mesh);

            // Lazy Load Texture
            const imgName = this.images[i];
            new THREE.TextureLoader().load(`./thumbs/${imgName}.jpg`, (tex) => {
                tex.encoding = THREE.sRGBEncoding;
                tex.minFilter = THREE.LinearFilter;

                // Adjust scale for aspect ratio
                // We want a fixed height (Reference height 5 is good for visibility)
                const REF_HEIGHT = 5;
                const aspect = tex.image.width / tex.image.height;

                mesh.scale.set(REF_HEIGHT * aspect, REF_HEIGHT, 1);

                material.map = tex;
                material.color.setHex(0xffffff); // Reset color to white once loaded
                material.needsUpdate = true;
            });
        }
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
        const isMobile = width < height;
        // Scale distance relative to radius
        // Mobile needs more distance (FOV constraint)
        // Adjusting multipliers to bring camera closer (Bigger Sphere)
        const multiplier = isMobile ? 3.0 : 2.5;
        return this.radius * multiplier;
    }

    bindEvents() {
        const onDown = (x, y) => {
            if (this.layout === 'LINE') return; // Disable drag rotation in Line mode for now
            this.isDragging = true;
            this.previousMouse = { x, y };
        };

        const onMove = (x, y) => {
            if (this.isDragging) {
                const deltaX = x - this.previousMouse.x;
                const deltaY = y - this.previousMouse.y;

                this.targetRotation.y += deltaX * 0.005;
                this.targetRotation.x += deltaY * 0.005;

                this.previousMouse = { x, y };
            }
        };

        const onUp = () => {
            if (this.isDragging) {
                this.isDragging = false;
                // Add subtle throw/inertia stop here if desired later
            }
            this.previousPinchDist = 0; // Reset pinch
        };

        // Zoom Handler
        const handleZoom = (delta) => {
            if (this.isZoomedIn) return; // Don't interfere with transition

            const zoomSpeed = 0.5;
            let newZ = this.camera.position.z + delta * zoomSpeed;

            // Clamp Zoom
            // In LINE layout, allow getting much closer
            const minZ = this.layout === 'LINE' ? 5 : this.radius * 1.5; // Don't go inside sphere
            const maxZ = this.getOptimalDistance() * 2; // Allow backing out 2x default

            newZ = Math.max(minZ, Math.min(newZ, maxZ));

            this.camera.position.z = newZ;
            // Update baseDistance so resize doesn't snap it back immediately
            // But actually we might want resize to respect this new manual distance?
            // For now, let's update baseDistance = newZ so it persists.
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
                this.isDragging = false; // Pinch overrides drag
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
                    handleZoom(delta * 0.5);
                }
                this.previousPinchDist = dist;
            }
        }, { passive: false });

        window.addEventListener('touchend', onUp);

        // Click / Select logic ... (raycaster) -- REMAINING CODE BELOW --
        this.raycaster = new THREE.Raycaster();
        this.container.addEventListener('click', (e) => {
            // ... (keep click logic below)
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
                this.selectIndex(idx);
            }
        });

        // Resize
        window.addEventListener('resize', () => this.resize());
    }

    zoomAndSelect(index) {
        if (!this.frames[index]) return;
        this.currentIndex = index;

        // If we are already in LINE layout, just animate to the new center
        if (this.layout === 'LINE') {
            this.enterLineView(index);
            return;
        }

        // Standard Sphere Rotation Logic
        const targetMesh = this.frames[index];
        const currentWorldPos = new THREE.Vector3();
        targetMesh.getWorldPosition(currentWorldPos);
        const targetWorldPos = new THREE.Vector3(0, 0, this.radius);
        const rotationQ = new THREE.Quaternion().setFromUnitVectors(
            currentWorldPos.normalize(),
            targetWorldPos.normalize()
        );
        const startQ = this.pivot.quaternion.clone();
        const targetQ = rotationQ.multiply(startQ);

        gsap.to(this.pivot.quaternion, {
            x: targetQ.x,
            y: targetQ.y,
            z: targetQ.z,
            w: targetQ.w,
            duration: 1.2,
            ease: "power2.inOut",
            onComplete: () => {
                this.onSelect(index, true);
                this.isZoomedIn = false;
            }
        });

        // Zoom Camera In
        gsap.to(this.camera.position, {
            z: 40,
            duration: 1.2,
            ease: "power2.inOut",
            onComplete: () => {
                gsap.to(this.camera.position, {
                    z: this.baseDistance,
                    duration: 0.5,
                    delay: 0.1
                });
            }
        });
    }

    enterLineView(targetIndex) {
        this.layout = 'LINE';
        this.currentIndex = targetIndex;

        // 1. Reset Pivot Rotation to Identity (Straight line)
        // We animate this or snap it? Animate looks better.
        // Also reset state vars so they don't snap when we return to Sphere
        this.targetRotation = { x: 0, y: 0 };
        this.currentRotation = { x: 0, y: 0 };

        gsap.to(this.pivot.rotation, { x: 0, y: 0, z: 0, duration: 0.8, ease: "power2.out" });

        // 2. Animate Camera to a good viewing distance for simple line
        const lineDist = 15; // Tighter focus on single image (was 30)
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

        // 1. Reset Camera to Sphere base distance (Reset zoom)
        const defaultSphereDist = this.getOptimalDistance();

        // Update state so resize respects this reset
        this.baseDistance = defaultSphereDist;

        gsap.to(this.camera.position, { z: defaultSphereDist, duration: 1.0, ease: "power2.inOut" });

        // 2. Return frames to Sphere positions AND Rotations
        const dummy = new THREE.Object3D(); // Helper to calculate target rotation

        this.frames.forEach((mesh, i) => {
            const original = mesh.userData.originalPos;

            // Calculate Target Rotation (Look away from center)
            dummy.position.copy(original);
            dummy.lookAt(original.clone().multiplyScalar(2));
            dummy.updateMatrix(); // Ensure rotation is updated

            // Animate Position
            gsap.to(mesh.position, {
                x: original.x,
                y: original.y,
                z: original.z,
                duration: 1.0,
                ease: "power2.inOut"
            });

            // Animate Rotation (Quaternion)
            gsap.to(mesh.quaternion, {
                x: dummy.quaternion.x,
                y: dummy.quaternion.y,
                z: dummy.quaternion.z,
                w: dummy.quaternion.w,
                duration: 1.0,
                ease: "power2.inOut"
            });
        });
    }

    selectIndex(index) {
        if (!this.frames[index]) return;
        this.currentIndex = index;
        if (this.onPreload) this.onPreload(index);

        // Direct handoff to App logic (which triggers enterLineView)
        // Skip the intermediate sphere zoom/rotation
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
        // Only apply in SPHERE mode.
        if (this.layout !== 'LINE') {
            // Lerp factor independent of framerate: 1 - exp(-speed * dt)
            // Speed factor ~10.0 gives similar feel to original 0.1 at 60fps
            const smoothFactor = 1.0 - Math.exp(-10.0 * dt);

            this.currentRotation.x += (this.targetRotation.x - this.currentRotation.x) * smoothFactor;
            this.currentRotation.y += (this.targetRotation.y - this.currentRotation.y) * smoothFactor;

            this.pivot.rotation.x = this.currentRotation.x;
            this.pivot.rotation.y = this.currentRotation.y;
        }

        // Auto Rotate
        if (!this.isDragging) {
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
        requestAnimationFrame(this.animate);
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

        if (!this.isZoomedIn) {
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
                this.createFrames();
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
    }

    show() { this.container.style.display = 'block'; this.resize(); }
    hide() { this.container.style.display = 'none'; }
}
