import * as THREE from '/vendor/three/three.module.min.js';

export function mountMoleScene(board) {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.localClippingEnabled = true;
    const canvas = renderer.domElement;
    canvas.className = 'startup-mole-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-3, 3, 2, -2, .1, 50);
    camera.position.set(0, 6, 7);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x56819c, 2.2));
    const key = new THREE.DirectionalLight(0xffe4c3, 2);
    key.position.set(-3, 5, 4);
    scene.add(key);

    const geometry = new THREE.SphereGeometry(1, 20, 14);
    const wood = new THREE.CylinderGeometry(.11, .13, 1.22, 12);
    const head = new THREE.CylinderGeometry(.32, .32, .9, 16);
    const material = color => new THREE.MeshStandardMaterial({ color, roughness: .72 });
    const fur = material(0x596173);
    const muzzle = material(0xdaa29b);
    const dark = material(0x211e28);
    const claws = material(0xf5ded0);
    const opening = new THREE.Plane();
    for (const surface of [fur, muzzle, dark, claws]) surface.clippingPlanes = [opening];
    const teal = material(0x18819a);
    const rubber = material(0x093d50);
    const handle = material(0xe0a36c);
    const mesh = (parent, shape, surface, position, scale) => {
        const object = new THREE.Mesh(shape, surface);
        object.position.set(...position);
        if (scale) object.scale.set(...scale);
        parent.add(object);
        return object;
    };
    const mole = new THREE.Group();
    mole.scale.setScalar(.82);
    scene.add(mole);
    mesh(mole, geometry, fur, [0, -.28, 0], [.56, .72, .44]);
    mesh(mole, geometry, fur, [0, .26, .12], [.48, .41, .4]);
    mesh(mole, geometry, fur, [0, .19, .44], [.31, .24, .32]);
    mesh(mole, geometry, muzzle, [0, .12, .68], [.15, .12, .14]);
    for (const side of [-1, 1]) {
        mesh(mole, geometry, dark, [side * .26, .32, .45], [.046, .042, .035]);
        mesh(mole, geometry, muzzle, [side * .48, -.3, .34], [.2, .15, .16]);
        for (const toe of [-1, 0, 1]) {
            mesh(mole, geometry, claws, [side * .48 + toe * .09, -.32, .47], [.038, .05, .085]);
        }
    }
    const hammer = new THREE.Group();
    scene.add(hammer);
    mesh(hammer, wood, handle, [0, .6, 0]);
    mesh(hammer, head, teal, [0, 1.26, 0]).rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
        mesh(hammer, geometry, rubber, [side * .45, 1.26, 0], [.12, .34, .34]);
    }
    const holes = [...board.querySelectorAll('button')];
    const position = new THREE.Vector3();
    const screenUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const screenRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const contactOffset = new THREE.Vector3();
    let rise = 0;
    let moleIndex = -1;
    let strikeIndex = -1;
    let strikeAt = 0;
    let strikeHeight = 0;
    const place = index => {
        const area = canvas.getBoundingClientRect();
        const tile = holes[index].getBoundingClientRect();
        position.set((tile.left + tile.width / 2 - area.left) / area.width * 2 - 1,
            1 - (tile.top + tile.height * .72 - area.top) / area.height * 2, 0);
        position.unproject(camera);
    };
    function resize() {
        const { clientWidth: width, clientHeight: height } = canvas;
        if (!width || !height || !board.clientHeight) return;
        const halfHeight = 2 * height / board.clientHeight;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.left = -halfHeight * width / height;
        camera.right = -camera.left;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
    }
    const observer = new ResizeObserver(resize);
    board.append(canvas);
    observer.observe(board);
    resize();
    renderer.setAnimationLoop(() => {
        const active = holes.findIndex(hole => hole.classList.contains('has-mole'));
        const hit = holes.findIndex(hole => hole.classList.contains('is-hit'));
        const strike = hit >= 0 ? hit : holes.findIndex(hole => hole.classList.contains('is-miss'));
        if (strike !== strikeIndex) {
            strikeIndex = strike;
            strikeAt = performance.now();
            strikeHeight = strike === moleIndex && holes[strike]?.classList.contains('is-hit')
                ? Math.max(0, rise * 1.3 - .94 + .52)
                : 0;
        }
        const elapsed = performance.now() - strikeAt;
        const holdingForContact = strikeIndex >= 0 && strikeIndex === moleIndex
            && holes[strikeIndex].classList.contains('is-hit') && elapsed < 84;
        if (active !== moleIndex && rise < .02 && !holdingForContact) {
            moleIndex = active;
            rise = 0;
        }
        if (!holdingForContact) rise += ((active === moleIndex && active >= 0 ? 1 : 0) - rise) * .24;
        mole.visible = moleIndex >= 0 && rise > .01;
        if (mole.visible) {
            place(moleIndex);
            opening.setFromNormalAndCoplanarPoint(screenUp, position);
            mole.position.copy(position).addScaledVector(screenUp, rise * 1.3 - .94);
        }
        const progress = elapsed / 420;
        hammer.visible = strikeIndex >= 0 && progress < 1;
        if (hammer.visible) {
            place(strikeIndex);
            const swing = Math.min(progress / .2, 1);
            const lift = (1 - swing) ** 2 + .65 * Math.sin(Math.PI / 2 * Math.max(0, progress - .27) / .73);
            hammer.rotation.set(-.25, -.45, .45 + swing * .95);
            // Place the lower striking cap on the target, accounting for the swing rotation.
            contactOffset.set(-.57, 1.26, 0).applyQuaternion(hammer.quaternion);
            hammer.position.copy(position)
                .addScaledVector(screenUp, strikeHeight + lift * .9)
                .addScaledVector(screenRight, lift * .28)
                .sub(contactOffset);
        }
        renderer.render(scene, camera);
    });
    return () => {
        observer.disconnect();
        renderer.setAnimationLoop(null);
        for (const resource of [geometry, wood, head, fur, muzzle, dark, claws, teal, rubber, handle]) resource.dispose();
        renderer.dispose();
        canvas.remove();
    };
}
