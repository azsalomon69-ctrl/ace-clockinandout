import * as THREE from '/vendor/three/three.module.min.js';
import { GLTFLoader } from '/vendor/three/loaders/GLTFLoader.js';
import { RoomEnvironment } from '/vendor/three/environments/RoomEnvironment.js';

const previews = [...document.querySelectorAll('[data-tour-devices]')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const loader = new THREE.ImageLoader();

const modelLoader = new GLTFLoader();
const models = new Map();

function displayTexture(image, isPhone) {
    const displayAspect = isPhone ? .462 : 1.545;
    const canvas = document.createElement('canvas');
    canvas.width = isPhone ? 768 : 1440;
    canvas.height = Math.round(canvas.width / displayAspect);
    const context = canvas.getContext('2d');
    const side = Math.round(canvas.width * (isPhone ? .028 : .012));
    const top = Math.round(canvas.height * (isPhone ? .073 : .045));
    const bottom = Math.round(canvas.height * .022);
    const scale = Math.min((canvas.width - 2 * side) / image.naturalWidth,
        (canvas.height - top - bottom) / image.naturalHeight);
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);

    context.fillStyle = '#e8edf0';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, Math.round((canvas.width - width) / 2), top, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.anisotropy = 4;
    return texture;
}

async function deviceModel(name, image) {
    if (!models.has(name)) {
        models.set(name, modelLoader.loadAsync('/assets/tour-devices/' + name + '.glb').catch(error => {
            models.delete(name);
            throw error;
        }));
    }
    const model = (await models.get(name)).scene.clone();
    const display = model.getObjectByName('ACE_Display');
    if (!display?.isMesh) throw new Error('Device display was not found');
    const isPhone = name === 'phone';
    if (isPhone) model.rotation.y = Math.PI;
    display.material = new THREE.MeshBasicMaterial({ map: displayTexture(image, isPhone), toneMapped: false });

    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const device = new THREE.Group();
    device.add(model);
    device.userData.halfSize = size.clone().multiplyScalar(.5);
    device.scale.setScalar(isPhone ? 3.14 / size.y : 5.72 / size.x);
    return device;
}

async function activate() {
    if (!previews.length || typeof window.WebGL2RenderingContext !== 'function') return;
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
        return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const reflections = pmrem.fromScene(environment, .06);
    environment.dispose();
    pmrem.dispose();
    const canvas = renderer.domElement;
    canvas.className = 'public-device-canvas';
    canvas.setAttribute('role', 'img');
    const camera = new THREE.OrthographicCamera(-4, 4, 2.5, -2.5, .1, 30);
    camera.position.set(0, 1.28, 9);
    camera.lookAt(0, -.06, 0);
    camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const corner = new THREE.Vector3();
    const scenes = new Map();
    let active;
    let drag;
    let hover;
    const tilt = new THREE.Vector2();
    let visible = false;
    let frame = 0;
    let version = 0;

    function fitDevices({ devices, movable, handset }) {
        let xExtent = 0;
        let yExtent = 0;
        for (const device of devices) {
            const { x, y, z } = device.userData.halfSize;
            const rotation = device.rotation.clone();
            const isPhone = device === handset;
            const pitches = device !== movable ? [rotation.x] : isPhone ? [-1.1, -.55, 0, .55, 1.1] : [-.5, -.25, 0, .25, .5];
            const yaws = device !== movable ? [rotation.y] : isPhone
                ? Array.from({ length: 16 }, (_, i) => i * Math.PI / 8)
                : [-.65, -.325, 0, .325, .65];
            for (const pitch of pitches) {
                for (const yaw of yaws) {
                    device.rotation.set(pitch, yaw, rotation.z);
                    device.updateMatrixWorld(true);
                    for (const signX of [-1, 1]) {
                        for (const signY of [-1, 1]) {
                            for (const signZ of [-1, 1]) {
                                corner.set(x * signX, y * signY, z * signZ)
                                    .applyMatrix4(device.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
                                xExtent = Math.max(xExtent, Math.abs(corner.x));
                                yExtent = Math.max(yExtent, Math.abs(corner.y) + (isPhone ? .105 : 0));
                            }
                        }
                    }
                }
            }
            device.rotation.copy(rotation);
        }
        const zoom = Math.min(1, .92 * camera.right / xExtent, .92 * camera.top / yExtent);
        if (zoom !== camera.zoom) {
            camera.zoom = zoom;
            camera.updateProjectionMatrix();
        }
    }

    function render(timestamp) {
        frame = 0;
        if (!active) return;
        const motion = !reducedMotion.matches;
        const phase = timestamp * .0017;
        let settling = false;
        if (active.handset && drag?.device !== active.handset) {
            active.handset.position.y = .04 + (motion ? Math.sin(phase) * .105 : 0);
        }
        for (const device of [active.movable]) {
            if (device === drag?.device) continue;
            const rest = device.userData.rest;
            const hovering = motion && device === hover;
            const [x, y] = rotationAngles(rest.x + (hovering ? tilt.x : 0), rest.y + (hovering ? tilt.y : 0));
            if (motion) {
                device.rotation.x = THREE.MathUtils.lerp(device.rotation.x, x, .18);
                device.rotation.y = THREE.MathUtils.lerp(device.rotation.y, y, .18);
                settling ||= Math.abs(device.rotation.x - x) + Math.abs(device.rotation.y - y) > .001;
            } else {
                device.rotation.copy(rest);
            }
        }
        renderer.render(active.scene, camera);
        if (visible && (settling || (motion && active.handset))) requestRender();
    }
    function requestRender() {
        if (!frame) frame = requestAnimationFrame(render);
    }
    function resize() {
        if (!active) return;
        const { clientWidth: width, clientHeight: height } = active.preview;
        if (!width || !height) return;
        const aspect = width / height;
        const halfHeight = Math.max(2.22, 3.66 / aspect);
        camera.left = -halfHeight * aspect;
        camera.right = halfHeight * aspect;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        if (active.handset) active.handset.position.y = .04;
        fitDevices(active);
        requestRender();
    }
    const resizeObserver = new ResizeObserver(resize);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) requestRender();
    });
    visibilityObserver.observe(canvas);
    reducedMotion.addEventListener('change', requestRender);

    async function createScene(preview) {
        const desktop = preview.querySelector('.public-laptop img');
        const mobile = preview.querySelector('.public-phone img');
        const [desktopImage, mobileImage] = await Promise.all([
            loader.loadAsync(desktop.src),
            mobile ? loader.loadAsync(mobile.src) : null
        ]);
        const scene = new THREE.Scene();
        scene.environment = reflections.texture;
        scene.environmentIntensity = 1.35;
        const [computer, handset] = await Promise.all([
            deviceModel('laptop', desktopImage),
            mobileImage ? deviceModel('phone', mobileImage) : null
        ]);
        computer.position.x = mobile ? -.58 : 0;
        computer.rotation.set(-.08, -.13, 0);
        scene.add(computer);
        const devices = [computer];
        if (handset) {
            handset.position.set(2.42, .04, 3.48);
            handset.quaternion.copy(camera.quaternion);
            scene.add(handset);
            devices.push(handset);
        }
        const movable = handset || computer;
        movable.userData.front = movable.rotation.clone();
        movable.userData.rest = movable.rotation.clone();
        return { scene, devices, preview, handset, movable };
    }

    async function showActive() {
        const call = ++version;
        const preview = previews.find(item => !item.closest('.public-tour-panel').inert);
        if (preview === active?.preview) return;
        if (active) {
            resizeObserver.unobserve(active.preview);
            active.preview.classList.remove('has-device-scene');
            const hint = active.preview.parentElement.querySelector('.public-device-hint');
            if (hint) hint.hidden = true;
            canvas.remove();
            active = undefined;
            drag = undefined;
            hover = undefined;
        }
        if (!preview) return;
        if (!scenes.has(preview)) scenes.set(preview, createScene(preview));
        try {
            const next = await scenes.get(preview);
            if (call !== version) return;
            active = next;
            canvas.classList.add('is-interactive');
            canvas.tabIndex = 0;
            const deviceName = next.handset ? 'Phone' : 'Laptop';
            canvas.setAttribute('aria-label', deviceName + ' preview. Drag or use the arrow keys to rotate. Press Home to reset.');
            preview.append(canvas);
            preview.classList.add('has-device-scene');
            const hint = preview.parentElement.querySelector('.public-device-hint');
            if (hint) hint.hidden = false;
            resizeObserver.observe(preview);
            resize();
        } catch {
            scenes.delete(preview);
        }
    }

    function hit(event) {
        const bounds = canvas.getBoundingClientRect();
        pointer.set(2 * (event.clientX - bounds.left) / bounds.width - 1,
            1 - 2 * (event.clientY - bounds.top) / bounds.height);
        ray.setFromCamera(pointer, camera);
        for (const device of active.devices) device.updateMatrixWorld(true);
        let part = ray.intersectObjects(active.devices, true)[0]?.object;
        while (part && !active.devices.includes(part)) part = part.parent;
        return part;
    }
    function rotationAngles(pitch, yaw) {
        const { clamp } = THREE.MathUtils;
        return active.handset
            ? [clamp(pitch, -1.1, 1.1), yaw]
            : [clamp(pitch, -.5, .5), clamp(yaw, -.65, .65)];
    }
    canvas.addEventListener('pointerdown', event => {
        if (!active || event.button !== 0) return;
        const device = hit(event);
        if (device !== active.movable) return;
        hover = undefined;
        drag = { device, id: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
        if (!active) return;
        if (drag?.id === event.pointerId) {
            const rotation = drag.device.rotation;
            const [pitch, yaw] = rotationAngles(rotation.x + (event.clientY - drag.y) * .012,
                rotation.y + (event.clientX - drag.x) * .015);
            rotation.set(pitch, yaw, rotation.z);
            drag.x = event.clientX;
            drag.y = event.clientY;
        } else if (event.pointerType === 'mouse' && !reducedMotion.matches) {
            hover = hit(event) === active.movable ? active.movable : undefined;
            tilt.set(-pointer.y * .16, pointer.x * .24);
        }
        requestRender();
    });
    function keepRotation() {
        if (!drag) return;
        drag.device.userData.rest.copy(drag.device.rotation);
        drag = undefined;
        requestRender();
    }
    canvas.addEventListener('lostpointercapture', keepRotation);
    canvas.addEventListener('pointerleave', () => {
        hover = undefined;
        requestRender();
    });
    canvas.addEventListener('keydown', event => {
        if (!active || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
        event.preventDefault();
        const device = active.movable;
        if (event.key === 'Home') {
            device.rotation.copy(device.userData.front);
        } else {
            device.rotation.copy(device.userData.rest);
            if (event.key === 'ArrowLeft') device.rotation.y -= .2;
            if (event.key === 'ArrowRight') device.rotation.y += .2;
            if (event.key === 'ArrowUp') device.rotation.x -= .12;
            if (event.key === 'ArrowDown') device.rotation.x += .12;
            const [pitch, yaw] = rotationAngles(device.rotation.x, device.rotation.y);
            device.rotation.set(pitch, yaw, device.rotation.z);
        }
        device.userData.rest.copy(device.rotation);
        requestRender();
    });
    const state = new MutationObserver(showActive);
    for (const preview of previews) state.observe(preview.closest('.public-tour-panel'), { attributeFilter: ['inert'] });
    showActive();
}

activate();
