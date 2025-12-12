
// Three.js is loaded globally via CDN in index.html to avoid duplicate instance warnings
const THREE = window.THREE;


export class View3D {
    constructor(container) {
        this.container = container;
        this.camera = null;
        this.scene = null;
        this.renderer = null;
        this.pivot = null; // Comparison group for rotation
        this.frames = [];
        this.images = [];
        this.currentIndex = 0;

        // Globe Config
        this.radius = 25;

        // Interaction State
        this.isDragging = false;
        this.previousMousePosition = { x: 0, y: 0 };
        this.targetRotation = { x: 0, y: 0 };
        this.currentRotation = { x: 0, y: 0 };
        this.autoRotateSpeed = 0.001;
        this.isInteracting = false;
    }

    init(images, onSelect) {
        this.images = images;
        this.onSelect = onSelect;

        // 1. Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);

        // 2. Camera (Farther out)
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
        this.camera.position.z = 60;

        // 3. Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.container.appendChild(this.renderer.domElement);

        // 4. Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(1, 1, 2);
        this.scene.add(dirLight);

        // 5. Globe Group
        this.pivot = new THREE.Group();
        this.scene.add(this.pivot);

        // 6. Create Frames
        this.createFrames();

        // 7. Raycaster
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // 8. Bind Events
        this.bindEvents();

        // Start
        this.animate = this.animate.bind(this);
    }

    createFrames() {
        const textureLoader = new THREE.TextureLoader();
        const geometry = new THREE.PlaneGeometry(4.8, 3.2); // Frame size
        const count = this.images.length;
        const goldenRatio = (1 + Math.sqrt(5)) / 2;

        this.images.forEach((imgName, i) => {
            const material = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.5,
                metalness: 0.1,
                side: THREE.DoubleSide
            });

            const mesh = new THREE.Mesh(geometry, material);

            // Fibonacci Sphere Algorithm
            const i_norm = i + 0.5;
            const phi = Math.acos(1 - 2 * i_norm / count);
            const theta = Math.PI * 2 * i_norm * goldenRatio;

            const x = this.radius * Math.sin(phi) * Math.cos(theta);
            const y = this.radius * Math.cos(phi);
            const z = this.radius * Math.sin(phi) * Math.sin(theta);

            mesh.position.set(x, y, z);
            mesh.lookAt(0, 0, 0); // Face Center (Backs will face out)
            mesh.rotateY(Math.PI); // Rotate 180 to face OUT

            mesh.userData = { index: i, vector: new THREE.Vector3(x, y, z).normalize() };

            this.pivot.add(mesh);
            this.frames.push(mesh);

            textureLoader.load(`./thumbs/${imgName}.jpg`, (tex) => {
                tex.encoding = THREE.sRGBEncoding;
                tex.minFilter = THREE.LinearMipmapLinearFilter;

                // Aspect Ratio
                const imgAspect = tex.image.width / tex.image.height;
                const h = 3.2;
                const w = h * imgAspect;
                mesh.scale.set(w / 4.8, 1, 1);

                material.map = tex;
                material.needsUpdate = true;
            });
        });
    }

    bindEvents() {
        // Drag Rotation Logic
        this.container.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.isInteracting = true;
            this.previousMousePosition = { x: e.clientX, y: e.clientY };
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const deltaMove = {
                    x: e.clientX - this.previousMousePosition.x,
                    y: e.clientY - this.previousMousePosition.y
                };

                // Add to target rotation
                this.targetRotation.y += deltaMove.x * 0.005;
                this.targetRotation.x += deltaMove.y * 0.005;

                this.previousMousePosition = { x: e.clientX, y: e.clientY };
            }

            // Mouse tracking for raycaster
            this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        });

        document.addEventListener('mouseup', () => {
            this.isDragging = false;
            setTimeout(() => this.isInteracting = false, 2000); // Resume auto-rotate after delay
        });

        // Touch Support
        this.container.addEventListener('touchstart', (e) => {
            this.isDragging = true;
            this.isInteracting = true;
            this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }, { passive: false });

        this.container.addEventListener('touchmove', (e) => {
            if (this.isDragging) {
                const deltaMove = {
                    x: e.touches[0].clientX - this.previousMousePosition.x,
                    y: e.touches[0].clientY - this.previousMousePosition.y
                };

                this.targetRotation.y += deltaMove.x * 0.01;
                this.targetRotation.x += deltaMove.y * 0.01;

                this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        }, { passive: false });

        this.container.addEventListener('touchend', () => {
            this.isDragging = false;
            setTimeout(() => this.isInteracting = false, 2000);
        });

        // Click to Select
        this.container.addEventListener('click', (e) => {
            if (Math.abs(e.clientX - this.previousMousePosition.x) < 5 &&
                Math.abs(e.clientY - this.previousMousePosition.y) < 5) { // Ensure it's not a drag
                this.raycast();
            }
            // Update pos just in case
            this.previousMousePosition = { x: e.clientX, y: e.clientY };
        });

        // Wheel Zoom
        this.container.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.camera.position.z += e.deltaY * 0.05;
            this.camera.position.z = Math.max(30, Math.min(100, this.camera.position.z));
        }, { passive: false });
    }

    raycast() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        // Note: raycast against pivot.children to hit meshes
        const intersects = this.raycaster.intersectObjects(this.pivot.children);

        if (intersects.length > 0) {
            const index = intersects[0].object.userData.index;
            // Trigger the sequence: Rotate -> Zoom -> Open Viewer
            this.zoomAndSelect(index);
        }
    }

    zoomAndSelect(index) {
        if (!this.frames[index]) return;
        this.currentIndex = index;
        this.isNavigating = true; // Pause auto-rotation loop

        const targetMesh = this.frames[index];

        // 1. Calculate Target Rotation (align mesh normal to camera)
        // Target Vector: (0, 0, 1) - Facing camera
        // Start Vector: mesh.userData.vector (Local position on sphere)
        const startVec = targetMesh.userData.vector.clone();
        const targetVec = new THREE.Vector3(0, 0, 1);
        const targetQ = new THREE.Quaternion().setFromUnitVectors(startVec, targetVec);

        // 2. Animate Globe Rotation
        gsap.to(this.pivot.quaternion, {
            x: targetQ.x,
            y: targetQ.y,
            z: targetQ.z,
            w: targetQ.w,
            duration: 1.0,
            ease: "power2.inOut",
            onUpdate: () => {
                // Keep Euler vars in sync to prevent snap after animation behavior resumes
                const euler = new THREE.Euler().setFromQuaternion(this.pivot.quaternion);
                // Note: Euler angles are not unique, but this usually works enough for continuity
                this.currentRotation.x = euler.x;
                this.currentRotation.y = euler.y;
                this.targetRotation.x = euler.x;
                this.targetRotation.y = euler.y;
            },
            onComplete: () => {
                this.isNavigating = false;
                // 4. Open Viewer
                this.onSelect(index, true);
            }
        });

        // 3. Animate Camera Zoom In
        // Move closer to the surface (Radius is 25, Camera at 60. Target ~32?)
        gsap.to(this.camera.position, {
            z: 32,
            duration: 1.0,
            ease: "power2.inOut"
        });
    }

    // Legacy method optional, but we removed its internal usage
    goToIndex(index) {
        // ...
    }

    resize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        if (!this.renderer) return;

        // Skip rotation logic if we are navigating/zooming specifically
        if (!this.isNavigating) {
            // Smooth Rotation
            this.currentRotation.x += (this.targetRotation.x - this.currentRotation.x) * 0.1;
            this.currentRotation.y += (this.targetRotation.y - this.currentRotation.y) * 0.1;

            // Apply rotation
            this.pivot.rotation.x = this.currentRotation.x;
            this.pivot.rotation.y = this.currentRotation.y;

            // Auto Rotate if idle
            if (!this.isInteracting && !this.isDragging) {
                this.targetRotation.y += this.autoRotateSpeed;
            }
        }

        this.renderer.render(this.scene, this.camera);
        this.animationId = requestAnimationFrame(this.animate);
    }

    show() {
        this.container.classList.remove('hidden');
        if (!this.animationId) this.animate();
    }

    hide() {
        this.container.classList.add('hidden');
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
}
