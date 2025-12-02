import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/controls/OrbitControls.js';

// ============================================
// CONSOLE WARNING SUPPRESSION
// ============================================
// Suppress meshopt_decoder warnings permanently
const originalWarn = console.warn;
console.warn = function (...args) {
    // Check if this is the meshopt_decoder warning
    if (args.length > 0 && typeof args[0] === 'string' &&
        args[0].includes('meshopt_decoder') &&
        args[0].includes('experimental SIMD')) {
        // Suppress this specific warning
        return;
    }
    // Pass through all other warnings
    originalWarn.apply(console, args);
};


// ============================================
// MQTT CONNECTION SETUP
// ============================================

// Replace these with YOUR HiveMQ Cloud credentials
const MQTT_CONFIG = {
    host: 'wss://751563c505a94e2ea912e4e3554f7d93.s1.eu.hivemq.cloud:8884/mqtt',
    options: {
        username: 'IsaRobotics',      // Replace with your username
        password: 'Isa12345678',      // Replace with your password
        clientId: 'meshari_' + Math.random().toString(16).substr(2, 8),
        clean: true,
        reconnectPeriod: 1000
    }
};

let mqttClient = null;

// Connect to HiveMQ Cloud
function connectMQTT() {
    try {
        mqttClient = mqtt.connect(MQTT_CONFIG.host, MQTT_CONFIG.options);

        mqttClient.on('connect', () => {
            console.log('✅ Connected to HiveMQ Cloud');
            updateConnectionStatus(true);
        });

        mqttClient.on('close', () => {
            console.log('❌ Disconnected from HiveMQ Cloud');
            updateConnectionStatus(false);
        });

        mqttClient.on('error', (err) => {
            console.error('❌ MQTT Connection Error:', err.message || err);
            updateConnectionStatus(false);
            // Don't let MQTT errors stop the script - arm should still load
        });

    } catch (error) {
        console.error('❌ Failed to initialize MQTT:', error.message || error);
        updateConnectionStatus(false);
        // Continue script execution even if MQTT fails
    }
}

// Update connection status indicator
function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('mqttStatus');
    if (statusElement) {
        if (connected) {
            statusElement.textContent = '🟢 Connected to MQTT';
            statusElement.style.color = '#00ff00';
        } else {
            statusElement.textContent = '🔴 Disconnected';
            statusElement.style.color = '#ff0000';
        }
    }
}

// Call this when page loads - use setTimeout to make it non-blocking
setTimeout(() => {
    try {
        connectMQTT();
    } catch (e) {
        console.error('MQTT initialization failed, but continuing...', e);
    }
}, 100);

// ============================================
// MQTT PUBLISHING FUNCTIONS
// ============================================

// Function to publish joint values to MQTT broker (unified for both sliders and buttons)
function publishJointValue(jointName, value, isRadians = true) {
    if (!mqttClient || !mqttClient.connected) {
        console.log('⚠️ Not connected to MQTT broker');
        return;
    }

    let valueToSend;

    if (isRadians) {
        // For sliders: convert degrees to radians
        const valueInRadians = value * (Math.PI / 180);
        valueToSend = valueInRadians.toFixed(4);
    } else {
        // For buttons: send the value directly (180 or 0)
        valueToSend = value.toString();
    }

    // Send as: "JointName", "value"
    const message = '"' + jointName + '", "' + valueToSend + '"';

    mqttClient.publish(
        'meshari/sliders',              // Topic name
        message,                        // Message payload (plain string)
        { qos: 0 }                      // Quality of Service
    );

    console.log('📤 Published to MQTT:', message);
}

function publishSliderValue(sliderName, value) {
    // Call the unified function with isRadians = true
    publishJointValue(sliderName, value, true);
}

function setupFingerButtons() {
    const fingerButtons = document.querySelectorAll('.individual-finger-btn');

    // Finger mapping to MQTT joint names
    const fingerMap = {
        'Move Index': 'IndexFinger',
        'Move Middle': 'MiddleFinger',
        'Move Ring': 'RingFinger',
        'Move Pinky': 'PinkyFinger',
        'Move Thumb': 'ThumbUpDown',
        'Move Thumb Sideways': 'ThumbSideways'
    };

    // Track finger states for toggle functionality
    const fingerStates = new Map();

    fingerButtons.forEach(button => {
        const fingerName = button.textContent;
        const jointName = fingerMap[fingerName];

        if (!jointName) {
            return;
        }

        // Initialize state to 0 (open) by default
        fingerStates.set(jointName, 0);

        button.addEventListener('click', function () {
            // Toggle between 180 and 0 degrees
            const currentState = fingerStates.get(jointName) || 0;
            const newValue = currentState === 180 ? 0 : 180;

            // Only send command if state is actually changing
            if (newValue !== currentState) {
                // Update state
                fingerStates.set(jointName, newValue);

                // Send the value (isRadians = false because we're sending degrees)
                publishJointValue(jointName, newValue, false);

                // Visual feedback
                this.classList.toggle('active', newValue === 180);

                console.log('👆 Finger button pressed:', jointName, newValue + '°');
            }
        });
    });

    // Initialize button visual states
    fingerButtons.forEach(button => {
        const fingerName = button.textContent;
        const jointName = fingerMap[fingerName];
        if (jointName) {
            const currentState = fingerStates.get(jointName) || 0;
            button.classList.toggle('active', currentState === 180);
        }
    });

    console.log('✓ Finger buttons setup complete');

    // NEW: Add Open/Close All buttons functionality
    setupOpenCloseButtons(fingerMap, fingerStates);
}

function setupOpenCloseButtons(fingerMap, fingerStates) {
    // Find buttons by their text content
    const allButtons = document.querySelectorAll('.finger-btn');
    let openAllBtn = null;
    let closeAllBtn = null;

    // Find buttons based on their text
    allButtons.forEach(button => {
        const text = button.textContent.trim();
        if (text === 'Open Fingers') {
            openAllBtn = button;
        } else if (text === 'Close Fingers') {
            closeAllBtn = button;
        }
    });

    if (!openAllBtn || !closeAllBtn) {
        console.warn('Open/Close All buttons not found in the HTML');
        return;
    }

    // Get all joint names from fingerMap (excluding thumb sideways for simplicity)
    const fingerJointNames = Object.values(fingerMap).filter(name => name !== 'ThumbSideways');

    openAllBtn.addEventListener('click', function () {
        // Check if any fingers are actually closed (state = 180)
        const closedFingers = fingerJointNames.filter(jointName => {
            const currentState = fingerStates.get(jointName) || 0;
            return currentState === 180;
        });

        // If no fingers are closed, do nothing
        if (closedFingers.length === 0) {
            // console.log('👐 All fingers are already open - no command sent');
            return;
        }

        console.log('👐 Opening all fingers (0°)');

        fingerJointNames.forEach(jointName => {
            // Update state to 0 (open)
            fingerStates.set(jointName, 0);

            // Send MQTT value (isRadians = false because we're sending degrees)
            publishJointValue(jointName, 0, false);

            console.log(`  Sent ${jointName}: 0°`);
        });

        // Update individual finger button visual states
        updateIndividualButtonStates(fingerStates, fingerMap);

        this.classList.add('active');
        closeAllBtn.classList.remove('active');
    });

    closeAllBtn.addEventListener('click', function () {
        // Check if any fingers are actually open (state = 0)
        const openFingers = fingerJointNames.filter(jointName => {
            const currentState = fingerStates.get(jointName) || 0;
            return currentState === 0;
        });

        // If no fingers are open, do nothing
        if (openFingers.length === 0) {
            // console.log('🤏 All fingers are already closed - no command sent');
            return;
        }

        console.log('🤏 Closing all fingers (180°)');

        fingerJointNames.forEach(jointName => {
            // Update state to 180 (closed)
            fingerStates.set(jointName, 180);

            // Send MQTT value (isRadians = false because we're sending degrees)
            publishJointValue(jointName, 180, false);

            console.log(`  Sent ${jointName}: 180°`);
        });

        // Update individual finger button visual states
        updateIndividualButtonStates(fingerStates, fingerMap);

        this.classList.add('active');
        openAllBtn.classList.remove('active');
    });

    // Initialize button active states based on current finger states
    function updateButtonActiveStates() {
        // Check current state of all fingers
        const allOpen = fingerJointNames.every(jointName => {
            const currentState = fingerStates.get(jointName) || 0;
            return currentState === 0;
        });

        const allClosed = fingerJointNames.every(jointName => {
            const currentState = fingerStates.get(jointName) || 0;
            return currentState === 180;
        });

        // Update button visual states
        openAllBtn.classList.toggle('active', allOpen);
        closeAllBtn.classList.toggle('active', allClosed);
    }

    // Initial update of button states
    updateButtonActiveStates();

    // Also update button states when individual fingers are toggled
    // We'll modify the updateIndividualButtonStates function to also update open/close buttons
    const originalUpdateIndividualButtonStates = updateIndividualButtonStates;
    updateIndividualButtonStates = function (fingerStates, fingerMap) {
        originalUpdateIndividualButtonStates(fingerStates, fingerMap);
        updateButtonActiveStates();
    };

    console.log('✓ Open/Close All buttons setup complete');
}
// HELPER FUNCTION: Update individual finger button visual states
function updateIndividualButtonStates(fingerStates, fingerMap) {
    const fingerButtons = document.querySelectorAll('.individual-finger-btn');

    fingerButtons.forEach(button => {
        const fingerName = button.textContent;
        const jointName = fingerMap[fingerName];

        if (jointName && fingerStates.has(jointName)) {
            const state = fingerStates.get(jointName);
            button.classList.toggle('active', state === 180);
        }
    });
}

document.addEventListener('DOMContentLoaded', function () {
    setTimeout(() => {
        setupFingerButtons();
    }, 500); // Small delay to ensure UI is ready
});

// ------------------------------------------------------------
// Finger positioning + curling logic (shared across the app)
// ------------------------------------------------------------

export const fingerSegmentsMap = new Map();        // key -> { base, mid, tip }
const segmentInitialRotations = new WeakMap();     // mesh -> { x, y, z }
const segmentInitialQuaternions = new WeakMap();   // mesh -> quaternion
const fingerCurlState = new Map();                 // key -> boolean

export const fingerCurlConfig = {
    default: { axis: 'y', angles: [0, 0, 0] },
    index: { axis: 'y', angles: [90, 90, 80] },
    middle: { axis: 'y', angles: [90, 90, 80] },
    ring: { axis: 'y', angles: [85, 85, 70] },
    pinky: { axis: 'y', angles: [80, 95, 60] },
    thumb: { axis: 'x', angles: [-50, -40, -30] }
};

export function rememberInitialRotation(segment) {
    if (!segment) return;
    if (!segmentInitialRotations.has(segment)) {
        segmentInitialRotations.set(segment, {
            x: segment.rotation.x,
            y: segment.rotation.y,
            z: segment.rotation.z
        });
    }
    if (!segmentInitialQuaternions.has(segment)) {
        segmentInitialQuaternions.set(segment, segment.quaternion.clone());
    }
}

export function resetSegmentState(segment) {
    if (!segment) return;
    segmentInitialRotations.delete(segment);
    segmentInitialQuaternions.delete(segment);
}

export function registerFingerSegments(segmentsByFinger) {
    Object.entries(segmentsByFinger).forEach(([key, parts]) => {
        if (!parts || !parts.base) {
            console.warn(`✗ Finger "${key}" missing base segment - cannot register.`);
            return;
        }

        const normalized = {
            base: parts.base || null,
            mid: parts.mid || null,
            tip: parts.tip || null
        };

        fingerSegmentsMap.set(key, normalized);
        [normalized.base, normalized.mid, normalized.tip].forEach(segment => {
            if (!segment) return;
            resetSegmentState(segment);
            rememberInitialRotation(segment);
        });

        if (!fingerCurlState.has(key)) {
            fingerCurlState.set(key, false);
        }

        const partNames = [
            normalized.base ? normalized.base.name : 'missing-base',
            normalized.mid ? normalized.mid.name : 'missing-mid',
            normalized.tip ? normalized.tip.name : 'missing-tip'
        ].join(', ');

    });
}

export function applyFingerCurl(fingerKey, shouldCurl, customConfig = {}) {
    const segments = fingerSegmentsMap.get(fingerKey);
    if (!segments) {
        console.warn(`Finger "${fingerKey}" not registered - skipping curl.`);
        return;
    }

    const configSource = fingerCurlConfig[fingerKey] || fingerCurlConfig.default;
    const config = {
        axis: (customConfig.axis || configSource.axis || fingerCurlConfig.default.axis).toLowerCase(),
        angles: customConfig.angles || configSource.angles || fingerCurlConfig.default.angles
    };

    const segmentList = [segments.base, segments.mid, segments.tip];
    const axisVec = new THREE.Vector3();
    axisVec[config.axis] = 1;  // Unit vector along the axis

    segmentList.forEach((segment, idx) => {
        if (!segment) return;

        rememberInitialRotation(segment);
        const initialQuat = segmentInitialQuaternions.get(segment);
        if (!initialQuat) {
            console.warn(`Initial quaternion missing for ${segment.name}`);
            return;
        }

        const targetDeg = shouldCurl
            ? (config.angles[idx] ?? config.angles[config.angles.length - 1] ?? 0)
            : 0;
        const radians = THREE.MathUtils.degToRad(targetDeg);

        segment.quaternion.copy(initialQuat);

        const curlQuat = new THREE.Quaternion().setFromAxisAngle(axisVec, radians);
        segment.quaternion.premultiply(curlQuat);  // Apply curl rotation in local space

        segment.updateMatrixWorld(true);

        if (segment.parent) {
            segment.parent.updateMatrixWorld(true);
        }
    });

    // update full chain
    if (segments.base && segments.base.parent) {
        segments.base.parent.updateMatrixWorld(true);
    }
    if (segments.base) segments.base.updateMatrixWorld(true);
    if (segments.mid) segments.mid.updateMatrixWorld(true);
    if (segments.tip) segments.tip.updateMatrixWorld(true);

    fingerCurlState.set(fingerKey, shouldCurl);
}

export function toggleFingerCurl(fingerKey, customConfig = {}) {
    const shouldCurl = !(fingerCurlState.get(fingerKey) || false);
    applyFingerCurl(fingerKey, shouldCurl, customConfig);
}

export function resetAllFingers() {
    fingerSegmentsMap.forEach((_segments, key) => {
        applyFingerCurl(key, false);
    });
}

// ------------------------------------------------------------
// Hand hierarchy discovery + repair logic
// ------------------------------------------------------------

const fingerNameCandidates = {
    index: {
        base: ['Index1_1', 'Index1_1_1', 'Index1'],
        mid: ['Index2_1', 'Index2_1_1', 'Index2'],
        tip: ['Index3_1', 'Index3_1_1', 'Index3']
    },
    middle: {
        base: ['Midle1_1', 'Midle1_1_1', 'Midle1'],
        mid: ['Midle2_1', 'Midle2_1_1', 'Midle2'],
        tip: ['Midle3_1', 'Midle3_1_1', 'Midle3']
    },
    ring: {
        base: ['Ring3_1', 'Ring3_1_1', 'Ring3'],
        mid: ['Ring2_1', 'Ring2_1_1', 'Ring2'],
        tip: ['Ring1_1', 'Ring1_1_1', 'Ring1']
    },
    pinky: {
        base: ['Pinky3_1', 'Pinky3_1_1', 'Pinky3'],
        mid: ['Pinky2_1', 'Pinky2_1_1', 'Pinky2'],
        tip: ['Pinky1_1', 'Pinky1_1_1', 'Pinky1']
    },
    thumb: {
        base: ['Thumb3_1', 'Thumb3_1_1', 'Thumb3'],
        mid: ['Thumb2_1', 'Thumb2_1_1', 'Thumb2'],
        tip: ['Thumb1_1', 'Thumb1_1_1', 'Thumb1']
    }
};

const reparentTemp = {
    worldMatrix: new THREE.Matrix4(),
    parentInverse: new THREE.Matrix4(),
    localMatrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3()
};

export function reparentPreserveWorld(parent, child, label = '') {
    if (!parent || !child || child.parent === parent) return;
    if (wouldCreateCycle(parent, child)) {
        console.warn(`Skipping ${label || 'reparent'} - would create cycle`);
        return;
    }

    const { worldMatrix, parentInverse, localMatrix, position, quaternion, scale } = reparentTemp;

    child.updateMatrixWorld(true);
    parent.updateMatrixWorld(true);

    worldMatrix.copy(child.matrixWorld);
    parentInverse.copy(parent.matrixWorld).invert();
    localMatrix.multiplyMatrices(parentInverse, worldMatrix);
    localMatrix.decompose(position, quaternion, scale);

    if (child.parent) {
        child.parent.remove(child);
    }
    parent.add(child);

    child.position.copy(position);
    child.quaternion.copy(quaternion);
    child.scale.copy(scale);
    child.updateMatrixWorld(true);

    if (label) {
    }
}

export function enforceFingerHierarchy(segments, label = '') {
    if (!segments || !segments.base) return;

    const { base, mid, tip } = segments;
    if (mid) {
        reparentPreserveWorld(base, mid, `${label} mid -> base`);
    }
    if (tip) {
        reparentPreserveWorld(mid || base, tip, `${label} tip -> ${mid ? 'mid' : 'base'}`);
    }
}

export function wouldCreateCycle(parent, child) {
    if (!parent || !child) return false;
    let current = parent;
    while (current) {
        if (current === child) return true;
        current = current.parent || null;
    }
    return false;
}

export function resolveFingerSegments(model) {
    const groups = {};
    Object.entries(fingerNameCandidates).forEach(([finger, parts]) => {
        groups[finger] = {
            base: findSegment(model, parts.base),
            mid: findSegment(model, parts.mid),
            tip: findSegment(model, parts.tip)
        };

        ['base', 'mid', 'tip'].forEach(part => {
            if (!groups[finger][part]) {
                console.warn(`Finger "${finger}" missing ${part} segment.`);
            }
        });
    });
    return groups;
}

function findSegment(model, candidates) {
    for (const candidate of candidates) {
        const found = findMeshByName(model, candidate);
        if (found) return found;
    }
    return null;
}

export function findMeshByName(model, partialName) {
    let bestMatch = null;
    let bestScore = Infinity;
    let bestTypeRank = Infinity;

    const exactLower = partialName.toLowerCase();

    model.traverse(child => {
        if (!child.name) return;
        const childLower = child.name.toLowerCase();
        let score = null;
        if (child.name === partialName) score = 0;
        else if (childLower === exactLower) score = 1;
        else if (childLower.includes(exactLower)) score = 2;
        else if (exactLower.includes(childLower)) score = 3;

        if (score === null) return;
        const typeRank = child.isMesh ? 0 : (child.isBone ? 1 : 2);
        if (score < bestScore || (score === bestScore && typeRank < bestTypeRank)) {
            bestMatch = child;
            bestScore = score;
            bestTypeRank = typeRank;
        }
    });

    return bestMatch;
}

export function ensurePalm(model, explicitPalmName = 'Palm_1') {
    let palm = findMeshByName(model, explicitPalmName);
    if (!palm) {
        palm = findMeshByName(model, 'Palm');
    }
    if (!palm) {
        throw new Error('Palm mesh not found. Provide explicit palm reference.');
    }
    return palm;
}

export function buildFingerHierarchy(model, options = {}) {
    if (!model) throw new Error('Model not provided to buildFingerHierarchy');

    const palm = options.palm || ensurePalm(model, options.palmName || 'Palm_1');
    const segmentGroups = resolveFingerSegments(model);

    Object.entries(segmentGroups).forEach(([label, segments]) => {
        if (!segments || !segments.base) return;
        enforceFingerHierarchy(segments, label);
        reparentPreserveWorld(palm, segments.base, `${label} base -> ${palm.name}`);
    });

    // prime initial rotations for curling logic
    Object.values(segmentGroups).forEach(parts => {
        Object.values(parts).forEach(segment => rememberInitialRotation(segment));
    });

    registerFingerSegments(segmentGroups);
    return segmentGroups;
}

(function () {
    const container = document.getElementById('isaacSimWindow');
    if (!container) {
        console.error('Container not found');
        return;
    }

    // Wait for container to have dimensions
    function initThreeJS() {
        if (container.clientWidth === 0 || container.clientHeight === 0) {
            setTimeout(initThreeJS, 100);
            return;
        }

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setClearColor(0x1a1a2a);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(renderer.domElement);

        camera.position.set(5, 3, 5);
        camera.lookAt(0, 1, 0);

        // Add OrbitControls for mouse camera movement
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true; // Smooth camera movement
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = false;
        controls.minDistance = 3; // Minimum zoom distance
        controls.maxDistance = 15; // Maximum zoom distance
        controls.maxPolarAngle = Math.PI / 2; // Prevent camera going below ground
        controls.target.set(0, 1, 0); // Look at arm center

        // Reduced lighting with shadows
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
        scene.add(ambientLight);

        const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.4);
        directionalLight1.position.set(5, 5, 5);
        directionalLight1.castShadow = true;
        directionalLight1.shadow.mapSize.width = 2048;
        directionalLight1.shadow.mapSize.height = 2048;
        directionalLight1.shadow.camera.near = 0.5;
        directionalLight1.shadow.camera.far = 50;
        directionalLight1.shadow.camera.left = -10;
        directionalLight1.shadow.camera.right = 10;
        directionalLight1.shadow.camera.top = 10;
        directionalLight1.shadow.camera.bottom = -10;
        scene.add(directionalLight1);

        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.15);
        directionalLight2.position.set(-5, 3, -5);
        scene.add(directionalLight2);

        // Enable shadow rendering
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Add axes helper at origin, centered with arm, longer lines for better visibility
        const axesHelper = new THREE.AxesHelper(8);
        scene.add(axesHelper);

        let model = null;
        const motors = {
            motor2: null,
            motor3: null,
            motor4: null,
            motor5: null
        };

        // ============================================
        // GLB HIERARCHY ANALYSIS AND CORRECTION SYSTEM
        // ============================================


        function loadGLTFModel(filePath) {
            const loader = new GLTFLoader();
            loader.setMeshoptDecoder(MeshoptDecoder);
            loader.load(
                filePath,
                function (gltf) {
                    model = gltf.scene;

                    // Enable shadows, improve materials, and remove base_link, Cube, and mesh_0
                    let meshCount = 0;
                    let hiddenCount = 0;

                    // First pass: Hide base_link, Cube, and related objects (works on all object types)
                    model.traverse(function (child) {
                        const name = child.name || '';
                        const nameLower = name.toLowerCase();

                        // Check if this is a base/cube/link object that should be hidden
                        if (name === 'base_link' ||
                            name === 'Cube' ||
                            name === 'mesh_0' ||
                            nameLower.includes('base_link') ||
                            nameLower.includes('baselink') ||
                            (nameLower.includes('base') && nameLower.includes('link')) ||
                            (nameLower === 'cube') ||
                            nameLower.includes('ground') ||
                            nameLower.includes('platform')) {
                            child.visible = false;
                            hiddenCount++;

                            // Also hide all children of this object
                            child.traverse(function (descendant) {
                                if (descendant !== child) {
                                    descendant.visible = false;
                                }
                            });
                            return;
                        }
                    });

                    // Second pass: Setup shadows and materials for visible arm meshes
                    model.traverse(function (child) {
                        if (child.isMesh && child.visible) {
                            meshCount++;
                            child.castShadow = true;
                            child.receiveShadow = true;

                            // Improve material visibility with better shading
                            if (child.material) {
                                if (Array.isArray(child.material)) {
                                    child.material.forEach(mat => {
                                        if (mat) {
                                            mat.color.setHex(0xcccccc); // Slightly gray instead of pure white
                                            mat.roughness = 0.7;
                                            mat.metalness = 0.1;
                                        }
                                    });
                                } else {
                                    child.material.color.setHex(0xcccccc); // Slightly gray instead of pure white
                                    child.material.roughness = 0.7;
                                    child.material.metalness = 0.1;
                                }
                            }
                        }
                    });

                    const box = new THREE.Box3().setFromObject(model);
                    const size = box.getSize(new THREE.Vector3());

                    const maxDim = Math.max(size.x, size.y, size.z);
                    if (maxDim > 0) {
                        const scale = 5 / maxDim;
                        model.scale.set(scale, scale, scale);
                    }

                    // Reset all rotations to ensure model loads correctly
                    model.traverse(function (child) {
                        if (child.rotation) {
                            child.rotation.set(0, 0, 0);
                        }
                    });

                    // Rotate model to stand vertically (arm extends along Z axis)
                    // Rotate around X axis to make horizontal arm vertical
                    model.rotation.x = -Math.PI / 2;

                    scene.add(model);

                    // Update matrix world to ensure model is positioned correctly
                    model.updateMatrixWorld(true);

                    // Scan GLTF structure to find correct hierarchy
                    const allObjects = [];
                    const allMeshes = [];
                    const meshToParentMap = new Map();

                    model.traverse(function (child) {
                        allObjects.push(child);
                        if (child.isMesh && child.name !== 'mesh_0' && !(child.name && child.name.toLowerCase().includes('base'))) {
                            allMeshes.push(child);
                            if (child.parent) {
                                meshToParentMap.set(child, child.parent);
                            }
                        }
                    });

                    // Log ALL objects (not just meshes) to see the complete structure
                    const allObjectsDetailed = [];
                    model.traverse(function (child) {
                        allObjectsDetailed.push({
                            name: child.name || 'unnamed',
                            type: child.type,
                            isMesh: child.isMesh || false,
                            isBone: child.isBone || false,
                            parent: child.parent ? (child.parent.name || 'unnamed parent') : 'root'
                        });
                    });
                    allObjectsDetailed.forEach((obj, index) => {
                        const typeInfo = obj.isMesh ? '[MESH]' : (obj.isBone ? '[BONE]' : `[${obj.type}]`);
                    });

                    // Log ALL meshes in order with their details
                    // console.log('=== ALL MESHES IN ORDER ===');
                    const allMeshesOrdered = [];
                    model.traverse(function (child) {
                        if (child.isMesh) {
                            allMeshesOrdered.push({
                                name: child.name || 'unnamed',
                                index: allMeshesOrdered.length,
                                parent: child.parent ? (child.parent.name || 'unnamed') : 'root',
                                type: child.type,
                                visible: child.visible
                            });
                        }
                    });
                    allMeshesOrdered.forEach((mesh, index) => {
                    });

                    // Extract and categorize mesh names for easier identification
                    const meshCategories = {
                        shoulder: [],
                        biceps: [],
                        forearm: [],
                        palm: [],
                        fingers: {
                            index: [],
                            middle: [],
                            pinky: [],
                            ring: [],
                            thumb: []
                        },
                        other: []
                    };

                    allMeshesOrdered.forEach(mesh => {
                        const nameLower = mesh.name.toLowerCase();
                        if (nameLower.includes('shoulder')) meshCategories.shoulder.push(mesh.name);
                        else if (nameLower.includes('biceps') || nameLower.includes('bicep')) meshCategories.biceps.push(mesh.name);
                        else if (nameLower.includes('forearm') || nameLower.includes('fore')) meshCategories.forearm.push(mesh.name);
                        else if (nameLower.includes('palm') || nameLower.includes('hand')) meshCategories.palm.push(mesh.name);
                        else if (nameLower.includes('index')) meshCategories.fingers.index.push(mesh.name);
                        else if (nameLower.includes('middle')) meshCategories.fingers.middle.push(mesh.name);
                        else if (nameLower.includes('pinky') || nameLower.includes('pink')) meshCategories.fingers.pinky.push(mesh.name);
                        else if (nameLower.includes('ring')) meshCategories.fingers.ring.push(mesh.name);
                        else if (nameLower.includes('thumb')) meshCategories.fingers.thumb.push(mesh.name);
                        else meshCategories.other.push(mesh.name);
                    });

                    const parentGroups = [];
                    allObjects.forEach(obj => {
                        if ((obj.type === 'Group' || obj.type === 'Bone' || obj.type === 'Object3D') && obj.children.length > 0) {
                            const meshChildren = [];
                            obj.traverse(function (descendant) {
                                if (descendant.isMesh && descendant.name !== 'mesh_0') {
                                    meshChildren.push(descendant);
                                }
                            });
                            if (meshChildren.length > 0) {
                                parentGroups.push({
                                    object: obj,
                                    meshes: meshChildren,
                                    name: obj.name || 'unnamed'
                                });
                            }
                        }
                    });

                    parentGroups.forEach((pg, idx) => {
                        // console.log(`  Group ${idx}: ${pg.name} (${pg.meshes.length} meshes)`);
                    });

                    // Find Motor3 (Biceps) - should contain Motor2 (Elbow) mesh
                    // Motor2 is typically mesh_1 (elbow), Motor3 is mesh_2 (biceps)
                    const elbowMesh = allMeshes.find(m => m.name === 'mesh_1' || allMeshes.indexOf(m) === 0);
                    const bicepsMesh = allMeshes.find(m => m.name === 'mesh_2' || allMeshes.indexOf(m) === 1);

                    // Find the parent group that contains both biceps and elbow meshes
                    let bicepsParent = null;
                    if (bicepsMesh && bicepsMesh.parent) {
                        // Check if biceps parent also contains elbow
                        bicepsParent = bicepsMesh.parent;
                        let containsElbow = false;
                        bicepsParent.traverse(function (descendant) {
                            if (descendant === elbowMesh) {
                                containsElbow = true;
                            }
                        });

                        if (!containsElbow && elbowMesh && elbowMesh.parent) {
                            // If elbow is not a child, find a common parent or make biceps parent of elbow
                            // Find the highest parent that contains biceps
                            let current = bicepsParent;
                            while (current.parent && current.parent !== model) {
                                current = current.parent;
                            }
                            bicepsParent = current;
                        }
                    }

                    // CRITICAL: Ensure model is visible and positioned correctly
                    model.visible = true;
                    model.updateMatrixWorld(true);

                    // Force all children to be visible
                    model.traverse(function (child) {
                        child.visible = true;
                        if (child.isMesh) {
                            child.visible = true;
                            child.matrixAutoUpdate = true;
                        }
                    });

                    // Verify model is in scene
                    if (!model.parent) {
                        console.error('Model not in scene! Adding now...');
                        scene.add(model);
                    }

                    // ============================================
                    // THREE.JS DIRECT PARENTING HIERARCHY
                    // ============================================
                    // STEP 1: Identify all arm objects in the scene
                    // Find objects by exact names (meshes, bones, or groups)
                    function findMeshByName(partialName) {
                        let found = null;
                        let meshFound = null;
                        let boneFound = null;
                        let groupFound = null;

                        // Create search variations: try exact name, without suffix, and base name
                        const searchVariations = [
                            partialName,                                    // e.g., "Shoulder_1"
                            partialName.replace(/_\d+$/, ''),              // e.g., "Shoulder" (remove _1 suffix)
                            partialName.replace(/\d+_\d+$/, ''),           // e.g., "Middle" (remove 3_1 suffix)
                            partialName.toLowerCase(),                      // case insensitive
                            partialName.replace(/_\d+$/, '').toLowerCase() // case insensitive without suffix
                        ];

                        model.traverse(function (child) {
                            if (!child.name) return;

                            const childName = child.name;
                            const nameLower = childName.toLowerCase();

                            // Try each search variation
                            for (const searchTerm of searchVariations) {
                                const searchLower = searchTerm.toLowerCase();

                                // Check for exact match
                                const isExactMatch = childName === searchTerm || nameLower === searchLower;

                                // Check for partial match (child name contains search term or vice versa)
                                const isPartialMatch = nameLower.includes(searchLower) || searchLower.includes(nameLower);

                                if (isExactMatch || isPartialMatch) {
                                    // Prefer meshes over other types
                                    if (child.isMesh && !meshFound) {
                                        meshFound = child;
                                    } else if (child.isBone && !boneFound) {
                                        boneFound = child;
                                    } else if (!groupFound) {
                                        groupFound = child;
                                    }

                                    // If we found a mesh, no need to continue searching
                                    if (meshFound) return;
                                }
                            }
                        });

                        // Return in order of preference: Mesh > Bone > Group
                        found = meshFound || boneFound || groupFound;

                        if (found) {
                            const typeStr = found.isMesh ? 'Mesh' : (found.isBone ? 'Bone' : found.type);
                        } else {
                            console.warn(`  findMeshByName('${partialName}'): NOT FOUND`);
                            // Log all similar mesh names to help debug
                            const baseName = partialName.replace(/_\d+$/, '').replace(/\d+_\d+$/, '').toLowerCase();
                            const similarMeshes = [];
                            model.traverse(function (child) {
                                if (child.isMesh && child.name) {
                                    const childBaseName = child.name.replace(/_\d+$/, '').replace(/\d+_\d+$/, '').toLowerCase();
                                    if (childBaseName.includes(baseName.substring(0, 4)) || baseName.includes(childBaseName.substring(0, 4))) {
                                        similarMeshes.push(child.name);
                                    }
                                }
                            });
                            if (similarMeshes.length > 0) {
                            }
                        }

                        return found;
                    }


                    // CRITICAL: Enhanced search for Shoulder_1 (actual name in GLB: Krahu_1_1)
                    let Shoulder_1 = findMeshByName('Krahu_1_1');  // Primary name (actual mesh name)
                    if (!Shoulder_1) {
                        // Try alternative names
                        Shoulder_1 = findMeshByName('Krahu') ||
                            findMeshByName('Shoulder_1') ||
                            findMeshByName('Shoulder') ||
                            findMeshByName('shoulder_1') ||
                            findMeshByName('shoulder') ||
                            findMeshByName('Shoulder_Blade') ||
                            findMeshByName('shoulder_blade');
                        if (Shoulder_1) {
                        }
                    } else {
                    }

                    // If still not found, search for any mesh with "shoulder" or "krahu" in the name
                    if (!Shoulder_1) {
                        model.traverse((child) => {
                            if (!Shoulder_1 && child.isMesh && child.name) {
                                const nameLower = child.name.toLowerCase();
                                if (nameLower.includes('shoulder') || nameLower.includes('shldr') || nameLower.includes('krahu')) {
                                    Shoulder_1 = child;
                                }
                            }
                        });
                    }


                    // Search for Mbajtesi_1 (Shoulder parent/base)
                    let Mbajtesi_1 = findMeshByName('Mbajtesi_1');
                    if (!Mbajtesi_1) {
                        Mbajtesi_1 = findMeshByName('Mbajtesi') ||
                            findMeshByName('mbajtesi_1') ||
                            findMeshByName('mbajtesi');
                    } else {
                    }

                    const Biceps_up_1 = findMeshByName('Biceps_up_1');

                    const Biceps_low_1 = findMeshByName('Biceps_low_1');

                    const Forearm_1 = findMeshByName('Forearm_1');

                    const Palm_1 = findMeshByName('Palm_1');

                    // INDEX FINGER (parent groups: Index3_1_1, Index2_1_1, Index1_1)
                    const Index3_1 = findMeshByName('Index3_1_1') || findMeshByName('Index3_1');
                    const Index2_1 = findMeshByName('Index2_1_1') || findMeshByName('Index2_1');
                    const Index1_1 = findMeshByName('Index1_1');

                    // MIDDLE FINGER (parent groups: Midle3_1_1, Midle2_1_1, Middle1_1) - note spelling!
                    const Middle3_1 = findMeshByName('Midle3_1_1') || findMeshByName('Middle3_1_1') || findMeshByName('Middle3_1');
                    const Middle2_1 = findMeshByName('Midle2_1_1') || findMeshByName('Middle2_1_1') || findMeshByName('Middle2_1');
                    const Middle1_1 = findMeshByName('Middle1_1');

                    // PINKY FINGER (parent groups: Pinky3_1_1, Pinky2_1, Pinky1_1)
                    const Pinky3_1 = findMeshByName('Pinky3_1_1') || findMeshByName('Pinky3_1');
                    const Pinky2_1 = findMeshByName('Pinky2_1');
                    const Pinky1_1 = findMeshByName('Pinky1_1');

                    // RING FINGER (parent groups: Ring3_1_1, Ring2_1, Ring1_1)
                    const Ring3_1 = findMeshByName('Ring3_1_1') || findMeshByName('Ring3_1');
                    const Ring2_1 = findMeshByName('Ring2_1');
                    const Ring1_1 = findMeshByName('Ring1_1');

                    // THUMB (parent groups: Thumb3_1_1, Thumb2_1_1, Thumb1_1)
                    const Thumb3_1 = findMeshByName('Thumb3_1_1') || findMeshByName('Thumb3_1');
                    const Thumb2_1 = findMeshByName('Thumb2_1_1') || findMeshByName('Thumb2_1');
                    const Thumb1_1 = findMeshByName('Thumb1_1');

                    // Summary of finger search results
                    const fingerResults = {
                        'Index3 (Index3_1_1)': Index3_1,
                        'Index2 (Index2_1_1)': Index2_1,
                        'Index1 (Index1_1)': Index1_1,
                        'Middle3 (Midle3_1_1)': Middle3_1,
                        'Middle2 (Midle2_1_1)': Middle2_1,
                        'Middle1 (Middle1_1)': Middle1_1,
                        'Pinky3 (Pinky3_1_1)': Pinky3_1,
                        'Pinky2 (Pinky2_1)': Pinky2_1,
                        'Pinky1 (Pinky1_1)': Pinky1_1,
                        'Ring3 (Ring3_1_1)': Ring3_1,
                        'Ring2 (Ring2_1)': Ring2_1,
                        'Ring1 (Ring1_1)': Ring1_1,
                        'Thumb3 (Thumb3_1_1)': Thumb3_1,
                        'Thumb2 (Thumb2_1_1)': Thumb2_1,
                        'Thumb1 (Thumb1_1)': Thumb1_1
                    };

                    const foundFingers = Object.entries(fingerResults).filter(([name, obj]) => obj !== null);
                    const missingFingers = Object.entries(fingerResults).filter(([name, obj]) => obj === null);

                    if (foundFingers.length > 0) {
                        foundFingers.forEach(([searchName, obj]) => {
                        });
                    }
                    if (missingFingers.length > 0) {
                        missingFingers.forEach(([searchName, obj]) => {
                        });
                    }
                    // ADDITIONAL: Search for finger parent groups that contain the actual meshes
                    const allFoundFingers = [Index3_1, Index2_1, Index1_1,
                        Middle3_1, Middle2_1, Middle1_1,
                        Pinky3_1, Pinky2_1, Pinky1_1,
                        Ring3_1, Ring2_1, Ring1_1,
                        Thumb3_1, Thumb2_1, Thumb1_1].filter(f => f !== null);

                    allFoundFingers.forEach(finger => {
                    });

                    // Log found objects
                    const armObjects = [Mbajtesi_1, Shoulder_1, Biceps_up_1, Biceps_low_1, Forearm_1, Palm_1,
                        Index3_1, Index2_1, Index1_1,
                        Middle3_1, Middle2_1, Middle1_1,
                        Pinky3_1, Pinky2_1, Pinky1_1,
                        Ring3_1, Ring2_1, Ring1_1,
                        Thumb3_1, Thumb2_1, Thumb1_1];

                    // STEP 2: Preserve current world positions and rotations
                    // Store world matrix of each object to maintain exact placement
                    model.updateMatrixWorld(true);
                    const worldMatrices = new Map();

                    armObjects.forEach(obj => {
                        if (obj) {
                            obj.updateMatrixWorld();
                            worldMatrices.set(obj, obj.matrixWorld.clone());
                        }
                    });

                    // STEP 3 & 4: Establish hierarchical chain using ThreeJS parenting system

                    // Remove ALL finger parent groups from their current parents
                    const allFingerSegments = [
                        Index3_1, Index2_1, Index1_1,
                        Middle3_1, Middle2_1, Middle1_1,
                        Pinky3_1, Pinky2_1, Pinky1_1,
                        Ring3_1, Ring2_1, Ring1_1,
                        Thumb3_1, Thumb2_1, Thumb1_1
                    ];

                    // Forearm_1 -> Palm_1
                    if (Forearm_1 && Palm_1) {
                        Forearm_1.add(Palm_1);
                    }

                    // Forearm_1 -> ALL finger parent groups (so Elbow moves all fingers including base segments)
                    if (Forearm_1) {
                        const fingerSegments = allFingerSegments.filter(f => f !== null);
                        if (fingerSegments.length > 0) {
                            fingerSegments.forEach(finger => {
                            });
                            Forearm_1.add(...fingerSegments);
                        } else {
                        }
                    } else {
                    }

                    // Biceps_low_1 -> Forearm_1
                    if (Biceps_low_1 && Forearm_1) {
                        Biceps_low_1.add(Forearm_1);
                    }

                    // Biceps_up_1 -> Biceps_low_1
                    if (Biceps_up_1 && Biceps_low_1) {
                        Biceps_up_1.add(Biceps_low_1);
                    }

                    // Mbajtesi_1 -> Shoulder_1 (Mbajtesi is the new root)


                    if (Shoulder_1 && Biceps_up_1) {
                        Shoulder_1.add(Biceps_up_1);
                    }

                    // Determine the root of the hierarchy
                    let armRoot = Mbajtesi_1 || Shoulder_1;

                    if (Mbajtesi_1) {
                        // Ensure Mbajtesi_1 has no parent before adding to model
                        if (Mbajtesi_1.parent && Mbajtesi_1.parent !== model && Mbajtesi_1.parent !== scene) {
                            Mbajtesi_1.parent.remove(Mbajtesi_1);
                        }

                        // Add Mbajtesi_1 to model if not already in scene hierarchy
                        if (!Mbajtesi_1.parent) {
                            model.add(Mbajtesi_1);
                        }

                        // Verify Mbajtesi_1 is in the scene graph
                        let isInScene = false;
                        let current = Mbajtesi_1;
                        let depth = 0;
                        let path = [Mbajtesi_1.name || 'Mbajtesi_1'];
                        while (current && depth < 20) {
                            if (current === scene) {
                                isInScene = true;
                                break;
                            }
                            current = current.parent;
                            if (current) path.push(current.name || current.type);
                            depth++;
                        }
                    } else if (Shoulder_1) {
                        // Ensure Shoulder_1 has no parent before adding to model
                        if (Shoulder_1.parent && Shoulder_1.parent !== model && Shoulder_1.parent !== scene) {
                            Shoulder_1.parent.remove(Shoulder_1);
                        }

                        // Add Shoulder_1 to model if not already in scene hierarchy
                        if (!Shoulder_1.parent) {
                            model.add(Shoulder_1);
                        }

                        // Verify Shoulder_1 is in the scene graph
                        let isInScene = false;
                        let current = Shoulder_1;
                        let depth = 0;
                        let path = [Shoulder_1.name || 'Shoulder_1'];
                        while (current.parent && depth < 10) {
                            current = current.parent;
                            path.push(current.name || current.type);
                            depth++;
                            if (current === scene || current === model) {
                                isInScene = true;
                                break;
                            }
                        }

                    } else if (Biceps_up_1) {
                        // Shoulder_1 (Krahu_1_1) not found - use Biceps_up_1 as root
                        console.warn('⚠ Shoulder_1 (Krahu_1_1) NOT FOUND - using Biceps_up_1 as ROOT');
                        if (!Biceps_up_1.parent) {
                            model.add(Biceps_up_1);
                        }
                    } else if (Biceps_low_1) {
                        console.warn('⚠⚠ Only Biceps_low_1 found (Shoulder_1/Krahu_1_1 missing)');
                        if (!Biceps_low_1.parent) {
                            model.add(Biceps_low_1);
                        }
                    } else if (Forearm_1) {
                        console.warn('⚠⚠⚠ Only Forearm_1 found (Shoulder_1/Krahu_1_1 missing)');
                        if (!Forearm_1.parent) {
                            model.add(Forearm_1);
                        }
                    }

                    // Restore world positions using stored matrices
                    // Calculate local transforms relative to new parents to preserve world positions
                    function restoreWorldTransform(obj, worldMatrix) {
                        if (!obj || !worldMatrix) return;

                        // Get parent world transform
                        if (obj.parent) {
                            obj.parent.updateMatrixWorld();
                            const parentWorldMatrix = obj.parent.matrixWorld.clone();

                            // Calculate local matrix: local = parent^-1 * world
                            const parentInverse = new THREE.Matrix4().copy(parentWorldMatrix).invert();
                            const localMatrix = new THREE.Matrix4().multiplyMatrices(parentInverse, worldMatrix);

                            // Extract position, rotation, scale from local matrix
                            const position = new THREE.Vector3();
                            const quaternion = new THREE.Quaternion();
                            const scale = new THREE.Vector3();
                            localMatrix.decompose(position, quaternion, scale);

                            // Apply local transform
                            obj.position.copy(position);
                            obj.quaternion.copy(quaternion);
                            obj.scale.copy(scale);
                        } else {
                            // No parent, use world matrix directly
                            const position = new THREE.Vector3();
                            const quaternion = new THREE.Quaternion();
                            const scale = new THREE.Vector3();
                            worldMatrix.decompose(position, quaternion, scale);
                            obj.position.copy(position);
                            obj.quaternion.copy(quaternion);
                            obj.scale.copy(scale);
                        }
                    }

                    // Restore transforms for all objects (process from root to leaves)
                    // Must restore in hierarchy order: parent before child

                    // Restore Mbajtesi_1 first (if it exists, it's the root)
                    if (Mbajtesi_1 && worldMatrices.has(Mbajtesi_1)) {
                        restoreWorldTransform(Mbajtesi_1, worldMatrices.get(Mbajtesi_1));
                        Mbajtesi_1.updateMatrixWorld(true);
                        // console.log('✓ Restored Mbajtesi_1 world transform');
                    }

                    if (Shoulder_1 && worldMatrices.has(Shoulder_1)) {
                        restoreWorldTransform(Shoulder_1, worldMatrices.get(Shoulder_1));
                        Shoulder_1.updateMatrixWorld(true);
                    }
                    if (Biceps_up_1 && worldMatrices.has(Biceps_up_1)) {
                        restoreWorldTransform(Biceps_up_1, worldMatrices.get(Biceps_up_1));
                        Biceps_up_1.updateMatrixWorld(true);
                    }
                    if (Biceps_low_1 && worldMatrices.has(Biceps_low_1)) {
                        restoreWorldTransform(Biceps_low_1, worldMatrices.get(Biceps_low_1));
                        Biceps_low_1.updateMatrixWorld(true);
                    }
                    if (Forearm_1 && worldMatrices.has(Forearm_1)) {
                        restoreWorldTransform(Forearm_1, worldMatrices.get(Forearm_1));
                        Forearm_1.updateMatrixWorld(true);
                    }
                    if (Palm_1 && worldMatrices.has(Palm_1)) {
                        restoreWorldTransform(Palm_1, worldMatrices.get(Palm_1));
                        Palm_1.updateMatrixWorld(true);
                    }
                    // Restore all finger segments (including base segments near palm)
                    allFingerSegments.forEach(finger => {
                        if (finger && worldMatrices.has(finger)) {
                            restoreWorldTransform(finger, worldMatrices.get(finger));
                            finger.updateMatrixWorld(true);
                        }
                    });

                    // Final update to ensure all matrices are synchronized
                    model.updateMatrixWorld(true);

                    // VERIFICATION: Check finger attachments
                    if (Forearm_1) {
                        const attachedFingers = allFingerSegments.filter(f => f !== null && f.parent === Forearm_1);
                        const detachedFingers = allFingerSegments.filter(f => f !== null && f.parent !== Forearm_1);

                        if (detachedFingers.length > 0) {
                            detachedFingers.forEach(f => {
                                console.error(`    - ${f.name} (parent: ${f.parent ? f.parent.name : 'none'})`);
                                // Try to re-attach
                                if (f.parent) f.parent.remove(f);
                                Forearm_1.add(f);
                            });
                        }

                    }

                    // VERIFICATION: Check complete hierarchy
                    function printHierarchy(obj, indent = 0) {
                        const prefix = '  '.repeat(indent);
                        const name = obj.name || 'unnamed';
                        const type = obj.isMesh ? '[MESH]' : obj.isBone ? '[BONE]' : `[${obj.type}]`;
                        obj.children.forEach(child => {
                            if (child.name && (
                                child.name.includes('Shoulder') ||
                                child.name.includes('Biceps') ||
                                child.name.includes('Forearm') ||
                                child.name.includes('Palm') ||
                                child.name.includes('Index') ||
                                child.name.includes('Middle') ||
                                child.name.includes('Pinky') ||
                                child.name.includes('Ring') ||
                                child.name.includes('Thumb')
                            )) {
                                printHierarchy(child, indent + 1);
                            }
                        });
                    }

                    // Count visible meshes
                    let visibleArmMeshes = 0;
                    model.traverse((child) => {
                        if (child.isMesh && child.visible && child.name && !child.name.includes('base') && !child.name.includes('mesh_0')) {
                            visibleArmMeshes++;
                        }
                    });

                    // Assign motors to the actual mesh objects (not groups)
                    // These will be used by the slider rotation functions
                    motors.motor2 = Forearm_1;      // Elbow rotates Forearm_1
                    motors.motor3 = Shoulder_1;     // Shoulder rotates Shoulder_1 (Z-axis - rotates in place)
                    motors.motor4 = Biceps_up_1;    // Shoulder Blade rotates Biceps_up_1 (X-axis - forward/back)
                    motors.motor5 = Biceps_low_1;   // Biceps rotates Biceps_low_1

                    // FINAL CHECK: Ensure base_link and Cube are hidden
                    let baseLinkFound = false;
                    let cubeFound = false;
                    model.traverse(function (child) {
                        const name = child.name || '';
                        if (name === 'base_link' || name.toLowerCase().includes('base_link') || name.toLowerCase().includes('baselink')) {
                            child.visible = false;
                            baseLinkFound = true;
                            child.traverse(function (desc) {
                                if (desc !== child) desc.visible = false;
                            });
                        }
                        if (name === 'Cube' || name.toLowerCase() === 'cube') {
                            child.visible = false;
                            cubeFound = true;
                            child.traverse(function (desc) {
                                if (desc !== child) desc.visible = false;
                            });
                        }
                    });

                    // Initialize the biomechanical arm joint system
                    // This sets up the hierarchical joint control for natural arm movement
                    setTimeout(() => {
                        ensureArmSystemInitialized();
                    }, 100); // Small delay to ensure all transforms are finalized
                },
                function (xhr) {
                    if (xhr.lengthComputable) {
                    }
                },
                function (error) {
                    console.error('Error loading GLTF model:', error);
                    console.error('Make sure the file exists and you are running from a web server (not file://)');
                    console.error('Try: python -m http.server 8000 (then open http://localhost:8000)');
                }
            );
        }

        const sliders = document.querySelectorAll('.slider-wrapper');
        const activeSliders = [];

        for (let i = 0; i < sliders.length; i++) {
            const label = sliders[i].querySelector('.slider-label');
            const slider = sliders[i].querySelector('.slider');

            if (label && label.textContent.trim() !== 'N/A' && slider && !slider.disabled) {
                activeSliders.push(slider);
            }
        }

        // ============================================
        // BIOMECHANICAL ARM MOVEMENT SYSTEM - HIERARCHICAL JOINT CONTROL
        // ============================================
        // This system implements natural humanoid arm movement where rotating any joint
        // automatically moves all connected child joints through proper ThreeJS parent-child hierarchy.
        //
        // HIERARCHY CHAIN (parent -> child):
        // Shoulder_1 -> Biceps_up_1 -> Biceps_low_1 -> Forearm_1 -> Palm_1 -> [All Finger Segments]
        //
        // When a parent rotates, all children automatically inherit that rotation through ThreeJS's
        // built-in matrix transformation system. This mimics real human biomechanics perfectly.

        // Store references to arm joint meshes
        const armJoints = {
            shoulderBlade: null,  // Shoulder_1 (root of arm hierarchy)
            shoulder: null,       // Biceps_up_1 (shoulder joint)
            biceps: null,         // Biceps_low_1 (upper arm twist)
            elbow: null           // Forearm_1 (elbow joint)
        };

        // Store initial rotations for each joint to enable relative rotation
        const initialRotations = new Map();

        /**
         * STEP 1: Find arm mesh objects by name in the loaded model
         * Supports flexible name matching to handle variations in GLB exports
         */
        function findArmMeshByName(name) {
            if (!model) {
                console.warn(`findArmMeshByName: model not loaded`);
                return null;
            }

            let found = null;
            const candidates = [];

            model.traverse((child) => {
                if (found) return;

                const childName = child.name || '';
                const nameLower = childName.toLowerCase();
                const searchLower = name.toLowerCase();

                // Collect all meshes for debugging
                if (child.isMesh && childName) {
                    candidates.push(childName);
                }

                // Try exact match first
                if (childName === name || nameLower === searchLower) {
                    found = child;
                    return;
                }

                // Try partial match (contains)
                if (nameLower.includes(searchLower) || searchLower.includes(nameLower)) {
                    if (!found) { // Only take first match
                        found = child;
                    }
                }
            });

            if (!found) {
                console.warn(`Could not find ${name}. Available meshes:`, candidates.slice(0, 20));
            }

            return found;
        }

        /**
         * STEP 2 & 3: Initialize the arm joint system
         * - Finds all arm meshes in the model
         * - Stores references to each joint
         * - Records initial rotations for relative movement
         * - Searches the model directly to find meshes
         */
        function initializeArmJointSystem() {
            if (!model) {
                console.warn('⚠ Model not loaded - cannot initialize arm joint system');
                return false;
            }

            // First try to use the motor assignments if available
            if (motors.motor4) armJoints.shoulderBlade = motors.motor4;  // motor4 = Biceps_up_1
            if (motors.motor3) armJoints.shoulder = motors.motor3;       // motor3 = Shoulder_1
            if (motors.motor5) armJoints.biceps = motors.motor5;
            if (motors.motor2) armJoints.elbow = motors.motor2;

            // If any are missing, search the model directly
            const meshNames = {
                shoulderBlade: 'Biceps_up_1',
                shoulder: 'Shoulder_1',
                biceps: 'Biceps_low_1',
                elbow: 'Forearm_1'
            };

            Object.keys(meshNames).forEach(jointKey => {
                if (!armJoints[jointKey]) {
                    // Try to find it in the model
                    armJoints[jointKey] = findArmMeshByName(meshNames[jointKey]);
                }
            });

            // Verify all joints were found
            const jointNames = ['shoulderBlade', 'shoulder', 'biceps', 'elbow'];
            const displayNames = ['Biceps_up_1', 'Shoulder_1', 'Biceps_low_1', 'Forearm_1'];
            let allFound = true;

            jointNames.forEach((jointKey, index) => {
                const joint = armJoints[jointKey];
                if (joint) {
                    // Store initial rotation (local space)
                    initialRotations.set(jointKey, {
                        x: joint.rotation.x,
                        y: joint.rotation.y,
                        z: joint.rotation.z
                    });
                } else {
                    console.warn(`✗ ${jointKey} joint (${displayNames[index]}): MISSING`);
                    allFound = false;
                }
            });

            // Verify hierarchy is correct by checking parent-child relationships

            // Check if Mbajtesi_1 exists and verify it's the parent of Shoulder_1
            let mbajtesiFound = false;
            if (model) {
                model.traverse((child) => {
                    if (child.name === 'Mbajtesi_1' || child.name === 'Mbajtesi') {
                        mbajtesiFound = true;
                    }
                });
            }
            if (!mbajtesiFound) {
                // console.log('ℹ Mbajtesi_1 not found in model - using Shoulder_1 as root');
            }

            // Check Shoulder_1 -> Biceps_up_1
            if (armJoints.shoulder && armJoints.shoulderBlade) {
                if (armJoints.shoulderBlade.parent === armJoints.shoulder) {
                } else {
                    console.warn('✗ Shoulder_1 -> Biceps_up_1 (incorrect, fixing...)');
                    // Try to fix the hierarchy
                    if (armJoints.shoulderBlade.parent) {
                        armJoints.shoulderBlade.parent.remove(armJoints.shoulderBlade);
                    }
                    armJoints.shoulder.add(armJoints.shoulderBlade);
                }
            } else {
                if (!armJoints.shoulder) {
                    console.warn('⚠ Shoulder_1 not found - Biceps_up_1 will be root of hierarchy');
                }
            }

            // Check Biceps_up_1 -> Biceps_low_1
            if (armJoints.shoulderBlade && armJoints.biceps) {
                if (armJoints.biceps.parent === armJoints.shoulderBlade) {
                    // console.log('✓ Biceps_up_1 -> Biceps_low_1 (correct)');
                } else {
                    console.warn('✗ Biceps_up_1 -> Biceps_low_1 (incorrect, fixing...)');
                    if (armJoints.biceps.parent) {
                        armJoints.biceps.parent.remove(armJoints.biceps);
                    }
                    armJoints.shoulderBlade.add(armJoints.biceps);
                    // console.log('✓ Fixed: Biceps_up_1 -> Biceps_low_1');
                }
            } else {
                if (!armJoints.shoulderBlade) {
                    console.warn('⚠ Biceps_up_1 not found - hierarchy incomplete');
                }
                if (!armJoints.biceps) {
                    console.warn('⚠ Biceps_low_1 not found - hierarchy incomplete');
                }
            }

            // Check Biceps_low_1 -> Forearm_1
            if (armJoints.biceps && armJoints.elbow) {
                if (armJoints.elbow.parent === armJoints.biceps) {
                    // console.log('✓ Biceps_low_1 -> Forearm_1 (correct)');
                } else {
                    console.warn('✗ Biceps_low_1 -> Forearm_1 (incorrect, fixing...)');
                    if (armJoints.elbow.parent) {
                        armJoints.elbow.parent.remove(armJoints.elbow);
                    }
                    armJoints.biceps.add(armJoints.elbow);
                    // console.log('✓ Fixed: Biceps_low_1 -> Forearm_1');
                }
            } else {
                if (!armJoints.biceps) {
                    console.warn('⚠ Biceps_low_1 not found - cannot attach Forearm_1');
                }
                if (!armJoints.elbow) {
                    console.warn('⚠ Forearm_1 not found - hierarchy incomplete');
                }
            }

            // Update world matrices after any hierarchy fixes
            model.updateMatrixWorld(true);

            return allFound;
        }

        /**
         * STEP 4-7: Movement functions for each joint
         * Each function rotates ONLY the specified joint mesh.
         * All child joints automatically move through ThreeJS parent-child hierarchy.
         */

        /**
         * STEP 4: Shoulder Blade Movement (Shoulder_1 X-axis rotation)
         * Rotates Shoulder_1 on X-axis for wheel-like spin along arm's length
         * Moves: Shoulder_1, Biceps_up_1, Biceps_low_1, Forearm_1, Palm_1, and all finger joints
         * @param {number} angle - Rotation angle in radians
         */
        function rotateShoulderBlade(angle) {
            // Rotate Shoulder_1 on X-axis (wheel-like spin along arm's length)
            const shoulderJoint = armJoints.shoulder;
            if (!shoulderJoint) {
                console.warn('⚠ Shoulder joint not available for shoulder blade slider');
                return;
            }

            const shoulderInitial = initialRotations.get('shoulder');
            if (!shoulderInitial) {
                console.warn('⚠ Initial rotation for shoulder not stored');
                return;
            }

            // Apply rotation to Shoulder_1's X-axis (spins like a wheel)
            shoulderJoint.rotation.x = shoulderInitial.x + angle;

            // Update Shoulder_1 matrices to propagate to all children
            shoulderJoint.updateMatrixWorld(true);
        }

        /**
         * STEP 5: Shoulder Movement (Biceps_up_1 with Shoulder_1 static)
         * Shoulder_1 stays static, only moves Biceps_up_1, Biceps_low_1, Forearm_1, Palm_1, and all finger joints
         * @param {number} angle - Rotation angle in radians
         */
        function rotateShoulder(angle) {
            // Rotate Biceps_up_1 on Y-axis while Shoulder_1 stays static
            const joint = armJoints.shoulderBlade; // This is Biceps_up_1
            if (!joint) {
                console.warn('⚠ Biceps_up_1 joint not available for shoulder slider');
                return;
            }

            const initial = initialRotations.get('shoulderBlade');
            if (!initial) return;

            // Rotate Biceps_up_1 around Y axis (arm moves while Shoulder_1 stays static)
            joint.rotation.y = initial.y + angle;

            // console.log(`  Shoulder slider: Biceps_up_1 rotation.y = ${joint.rotation.y.toFixed(3)} (angle: ${angle.toFixed(3)})`);

            // Update matrices to propagate transformation to all children
            joint.updateMatrixWorld(true);
        }

        /**
         * STEP 6: Biceps Movement (Biceps_low_1)
         * Moves: Biceps_low_1, Forearm_1, Palm_1, and all finger joints
         * @param {number} angle - Rotation angle in radians
         */
        function rotateBiceps(angle) {
            const joint = armJoints.biceps;
            if (!joint) {
                console.warn('⚠ Biceps joint not available');
                return;
            }

            const initial = initialRotations.get('biceps');
            if (!initial) return;

            // Rotate around Z axis (longitudinal rotation of forearm)
            joint.rotation.z = initial.z + angle;

            // Update matrices to propagate transformation to all children
            joint.updateMatrixWorld(true);
        }

        /**
         * STEP 7: Elbow Movement (Forearm_1)
         * Moves: Forearm_1, Palm_1, and all finger joints
         * @param {number} angle - Rotation angle in radians
         */
        function rotateElbow(angle) {
            const joint = armJoints.elbow;
            if (!joint) {
                console.warn('⚠ Elbow joint not available');
                return;
            }

            const initial = initialRotations.get('elbow');
            if (!initial) return;

            // Rotate around X axis (bend elbow)
            joint.rotation.x = initial.x + angle;

            // Update matrices to propagate transformation to all children
            joint.updateMatrixWorld(true);
        }

        // Track initialization state
        let armSystemInitialized = false;

        /**
         * Ensure arm joint system is initialized before use
         * Called automatically when sliders are moved
         */
        function ensureArmSystemInitialized() {
            if (!armSystemInitialized && model) {
                armSystemInitialized = initializeArmJointSystem();
            }
            return armSystemInitialized;
        }

        // ============================================
        // SLIDER EVENT HANDLERS - HIERARCHICAL ARM MOVEMENT WITH RATE LIMITING
        // ============================================
        // Each slider controls one joint. Moving a joint automatically moves all
        // hierarchical children through ThreeJS parent-child relationships.
        //
        // STEP 8: Ensure independent joint control with automatic child propagation

        // Rate limiting system to prevent fast motor movements
        const sliderAnimations = activeSliders.map(slider => ({
            currentValue: parseFloat(slider.value),
            targetValue: parseFloat(slider.value),
            animationId: null,
            isAnimating: false
        }));

        const MOVEMENT_SPEED = 60; // degrees per second (matches reset animation speed)

        function animateSliderToTarget(sliderIndex, slider, displayElement, rotateFunction, label) {
            const animation = sliderAnimations[sliderIndex];

            if (animation.currentValue === animation.targetValue) {
                animation.isAnimating = false;
                return;
            }

            const lastTime = animation.lastTime || Date.now();
            const currentTime = Date.now();
            const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
            animation.lastTime = currentTime;

            const maxStep = MOVEMENT_SPEED * deltaTime;
            const difference = animation.targetValue - animation.currentValue;
            const step = Math.sign(difference) * Math.min(Math.abs(difference), maxStep);

            animation.currentValue += step;

            // Update slider visual position
            // For SHOULDER slider (index 2), invert the value for display (0° shows as 0, -90° shows slider at 90)
            if (sliderIndex === 2) {
                slider.value = -animation.currentValue;  // Invert for visual slider position
            } else {
                slider.value = animation.currentValue;
            }

            // Update display card
            if (displayElement) {
                displayElement.textContent = `${animation.currentValue.toFixed(1)}°`;
            }

            // Apply rotation
            if (ensureArmSystemInitialized()) {
                const angleRad = animation.currentValue * (Math.PI / 180);
                rotateFunction(angleRad);

                // Publish gradual MQTT values during animation
                publishSliderValue(label.replace(' ', ''), animation.currentValue);
            }

            // Continue animation if not at target
            if (Math.abs(animation.targetValue - animation.currentValue) > 0.01) {
                animation.animationId = requestAnimationFrame(() =>
                    animateSliderToTarget(sliderIndex, slider, displayElement, rotateFunction, label)
                );
            } else {
                animation.currentValue = animation.targetValue;
                animation.isAnimating = false;
            }
        }

        function startSliderAnimation(sliderIndex, slider, displayElement, rotateFunction, label) {
            const animation = sliderAnimations[sliderIndex];
            animation.targetValue = parseFloat(slider.value);

            if (!animation.isAnimating) {
                animation.isAnimating = true;
                animation.lastTime = Date.now();
                animateSliderToTarget(sliderIndex, slider, displayElement, rotateFunction, label);
            }
        }

        // Slider 0: ELBOW - Controls Forearm_1 rotation
        // Moves: Forearm_1, Palm_1, and all finger joints
        activeSliders[0].addEventListener('input', function () {
            const displayElement = this.parentElement.querySelector('.slider-value-display');
            startSliderAnimation(0, this, displayElement, rotateElbow, 'Elbow');
            // Publish to MQTT
            publishSliderValue('Elbow', parseFloat(this.value));
        });

        // Slider 1: BICEPS - Controls Biceps_low_1 rotation
        // Moves: Biceps_low_1, Forearm_1, Palm_1, and all finger joints
        if (activeSliders[1]) {
            activeSliders[1].addEventListener('input', function () {
                const displayElement = this.parentElement.querySelector('.slider-value-display');
                startSliderAnimation(1, this, displayElement, rotateBiceps, 'Biceps');
                // Publish to MQTT
                publishSliderValue('Biceps', parseFloat(this.value));
            });
        }

        // Slider 2: SHOULDER - Controls Shoulder_1 rotation
        // Moves: Shoulder_1 and entire arm (Y-axis rotation)
        // Inverted: slider 0 (left) = 0°, slider 90 (right) = -90°
        if (activeSliders[2]) {
            activeSliders[2].addEventListener('input', function () {
                const displayElement = this.parentElement.querySelector('.slider-value-display');
                // Create a temporary slider-like object with inverted value
                const invertedSlider = {
                    value: -parseFloat(this.value)  // Invert the value
                };
                // Update display to show the actual negative value
                if (displayElement) {
                    displayElement.textContent = invertedSlider.value.toFixed(1) + '°';
                }
                // Pass the inverted value
                sliderAnimations[2].targetValue = invertedSlider.value;
                if (!sliderAnimations[2].isAnimating) {
                    sliderAnimations[2].isAnimating = true;
                    sliderAnimations[2].lastTime = Date.now();
                    animateSliderToTarget(2, this, displayElement, rotateShoulder, 'Shoulder');
                }
                // Publish to MQTT (send the inverted value)
                publishSliderValue('Shoulder', invertedSlider.value);
            });
        }

        // Slider 3: SHOULDER BLADE - Controls Biceps_up_1 rotation
        // Moves: Biceps_up_1, Biceps_low_1, Forearm_1, Palm_1, and all finger joints (X-axis forward/back)
        if (activeSliders[3]) {
            activeSliders[3].addEventListener('input', function () {
                const displayElement = this.parentElement.querySelector('.slider-value-display');
                startSliderAnimation(3, this, displayElement, rotateShoulderBlade, 'Shoulder Blade');
                // Publish to MQTT
                publishSliderValue('ShoulderBlade', parseFloat(this.value));
            });
        }

        // Reset button functionality
        const resetBtn = document.getElementById('resetSlidersBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                // console.log('Gradually resetting all sliders to 0°');

                // Update animation targets to 0 for all sliders
                // MQTT values will be published gradually during the animation
                activeSliders.forEach((slider, index) => {
                    // For SHOULDER slider (index 2), target is 0 (which will reset slider to left position)
                    sliderAnimations[index].targetValue = 0;

                    if (!sliderAnimations[index].isAnimating) {
                        const displayElement = slider.parentElement.querySelector('.slider-value-display');
                        sliderAnimations[index].isAnimating = true;
                        sliderAnimations[index].lastTime = Date.now();

                        const rotateFunction = [rotateElbow, rotateBiceps, rotateShoulder, rotateShoulderBlade][index];
                        const label = ['Elbow', 'Biceps', 'Shoulder', 'Shoulder Blade'][index];

                        animateSliderToTarget(index, slider, displayElement, rotateFunction, label);
                    }
                });
            });
        }

        function animate() {
            requestAnimationFrame(animate);

            // Update OrbitControls for smooth damping
            controls.update();

            // Update matrices every frame to ensure rotations propagate
            if (model) {
                model.updateMatrixWorld(true);
            }
            renderer.render(scene, camera);
        }

        function handleResize() {
            const width = container.clientWidth;
            const height = container.clientHeight;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        }

        window.addEventListener('resize', handleResize);

        const modelPath = 'hand.glb';
        const fileExtension = modelPath.split('.').pop().toLowerCase();

        if (fileExtension === 'gltf' || fileExtension === 'glb') {
            loadGLTFModel(modelPath);
        } else if (fileExtension === 'stl') {
            loadSTLModel(modelPath);
        }

        animate();
    }

    initThreeJS();
})();
