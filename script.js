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
// GLOBAL FINGER MESHES OBJECT
// ============================================
let fingerMeshes = {
    index: { base: null, mid: null, tip: null },
    middle: { base: null, mid: null, tip: null },
    pinky: { base: null, mid: null, tip: null },
    ring: { base: null, mid: null, tip: null },
    thumb: { base: null, mid: null, tip: null }
};

// ============================================
// MQTT CONNECTION SETUP
// ============================================

// Replace these with YOUR HiveMQ Cloud credentials
const MQTT_CONFIG = {
    // host: 'wss://broker.hivemq.com:8884/mqtt',
    options: {
        clientId: 'meshari_' + Math.random().toString(16).substr(2, 8),
        clean: true,
        reconnectPeriod: 1000,
        keepalive: 60
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
        'meshari/output',              // Topic name
        message,                        // Message payload (plain string)
        { qos: 0 }                      // Quality of Service
    );

    console.log('📤 Published to MQTT:', message);
}

function publishSliderValue(sliderName, value) {
    // Map human-readable names to custom IDs for MQTT
    const jointNameMap = {
        'Elbow': 'Brryli',
        'Shoulder': 'Krahu',
        'ShoulderBlade': 'Mbajtesi',
        'Biceps': 'Biceps'
    };

    // Convert slider name to custom ID
    const jointId = jointNameMap[sliderName] || sliderName;
    // Call the unified function with isRadians = true
    publishJointValue(jointId, value, true);
}

function setupFingerButtons() {
    const fingerButtons = document.querySelectorAll('.individual-finger-btn');

    // Finger mapping to MQTT joint names
    const fingerMap = {
        'Move Index': 'IndexFinger',
        'Move Middle': 'MiddleFinger',
        'Move Ring': 'RingFinger',
        'Move Pinky': 'PinkyFinger',
        // 'Move Thumb': 'ThumbUpDown',
        // 'Move Thumb Sideways': 'ThumbSideways'
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

                // Apply visual curl for corresponding finger
                const fingerKey = Object.keys(fingerMap).find(key => fingerMap[key] === jointName)?.toLowerCase();
                if (fingerKey && fingerSegmentsMap.has(fingerKey)) {
                    // Convert to boolean: 180 = curled (true), 0 = open (false)
                    const shouldCurl = newValue === 180;
                    applyFingerCurl(fingerKey, shouldCurl, {
                        axis: 'x',
                        angles: [-90, -90, -90]
                    });
                }

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


    // NEW: Add Open/Close All buttons functionality
    setupOpenCloseButtons(fingerMap, fingerStates);
}


// ============================================
// SLIDER CONTROL UTILITY FUNCTIONS
// ============================================

// Disable all sliders during automated movement
let activeSliders = [];

// Disable all sliders during automated movement
function disableAllSliders() {
    if (!activeSliders || activeSliders.length === 0) {
        console.warn('No active sliders found to disable');
        return;
    }
    activeSliders.forEach(slider => {
        slider.disabled = true;
        // Also disable the wrapper for visual feedback
        const wrapper = slider.closest('.slider-wrapper');
        if (wrapper) {
            wrapper.classList.add('disabled');
        }
    });

    // Also disable the reset button
    const resetBtn = document.getElementById('resetSlidersBtn');
    if (resetBtn) {
        resetBtn.disabled = true;
        resetBtn.style.opacity = '0.5';
    }
}

// Enable all sliders after automated movement
function enableAllSliders() {
    if (!activeSliders || activeSliders.length === 0) {
        console.warn('No active sliders found to enable');
        return;
    }

    activeSliders.forEach(slider => {
        slider.disabled = false;
        // Remove disabled wrapper class
        const wrapper = slider.closest('.slider-wrapper');
        if (wrapper) {
            wrapper.classList.remove('disabled');
        }
    });

    // Enable the reset button
    const resetBtn = document.getElementById('resetSlidersBtn');
    if (resetBtn) {
        resetBtn.disabled = false;
        resetBtn.style.opacity = '1';
    }
}

// Disable finger buttons during automated movement
function disableFingerButtons() {
    const fingerButtons = document.querySelectorAll('.finger-btn, .individual-finger-btn');
    fingerButtons.forEach(button => {
        button.disabled = true;
        button.style.opacity = '0.5';
        button.style.cursor = 'not-allowed';
    });
}

// Enable finger buttons after automated movement
function enableFingerButtons() {
    const fingerButtons = document.querySelectorAll('.finger-btn, .individual-finger-btn');
    fingerButtons.forEach(button => {
        button.disabled = false;
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
    });
}

// Track if any movement is active
let isMovementActive = false;

// Function to start any movement sequence
function startMovementSequence() {
    isMovementActive = true;
    disableAllSliders();
    disableFingerButtons();

    // Add visual indicator
    const statusElement = document.getElementById('mqttStatus');
    if (statusElement) {
        statusElement.textContent = '🟡 Movement Active';
        statusElement.style.color = '#ff9900';
    }
}

// Function to end any movement sequence
function endMovementSequence() {
    isMovementActive = false;
    enableAllSliders();
    enableFingerButtons();

    // Restore MQTT status
    if (mqttClient && mqttClient.connected) {
        const statusElement = document.getElementById('mqttStatus');
        if (statusElement) {
            statusElement.textContent = '🟢 Connected to MQTT';
            statusElement.style.color = '#00ff00';
        }
    }

    // Remove active class from all movement buttons
    const movementBtns = document.querySelectorAll('.movement-btn');
    movementBtns.forEach(btn => {
        btn.classList.remove('active');
    });
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
    default: { axis: 'x', angles: [-90, -90, -90] },  // Changed axis to 'x' and angles to negative 90
    index: { axis: 'x', angles: [-90, -90, -90] },    // Changed axis to 'x' and angles to -90 for all fingers
    middle: { axis: 'x', angles: [-90, -90, -90] },   // Changed axis to 'x' and angles to -90 for all fingers
    ring: { axis: 'x', angles: [-90, -90, -90] },     // Changed axis to 'x' and angles to -90 for all fingers
    pinky: { axis: 'x', angles: [-90, -90, -90] },    // Changed axis to 'x' and angles to -90 for all fingers
    thumb: { axis: 'x', angles: [0, 0, 0] }           // Set thumb to 0 to prevent curling
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

        camera.position.set(2, 1, 5);  // Increase y from 3 to 4
        camera.lookAt(0, 2, 0);        // Increase y from 1 to 2

        // Add OrbitControls for mouse camera movement
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true; // Smooth camera movement
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = false;
        controls.minDistance = 4; // Minimum zoom distance
        controls.maxDistance = 5; // Maximum zoom distance
        controls.maxPolarAngle = Math.PI / 2; // Prevent camera going below ground
        controls.target.set(0, 4.2, 0); // Look at higher point

        // ============================================
        // COMPREHENSIVE SHADOW SYSTEM OVERHAUL
        // ============================================

        // In the initThreeJS() function, REPLACE the entire lighting and shadow section:

        // NEW SHADOW SETTINGS - Much cleaner and higher quality
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Soft shadows
        renderer.shadowMap.autoUpdate = true;

        // 1. AMBIENT LIGHT - Soft overall illumination
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
        scene.add(ambientLight);

        // 2. MAIN KEY LIGHT - Clean, sharp shadows from top-right
        const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
        keyLight.position.set(10, 15, 5); // High and to the right
        keyLight.castShadow = true;

        // DRAMATICALLY IMPROVED SHADOW SETTINGS
        keyLight.shadow.mapSize.width = 2048; // Reduced from 4096 - cleaner, less pixelated
        keyLight.shadow.mapSize.height = 2048;
        keyLight.shadow.camera.near = 0.5;
        keyLight.shadow.camera.far = 50;

        // Tighter shadow frustum for sharper shadows
        keyLight.shadow.camera.left = -12;
        keyLight.shadow.camera.right = 12;
        keyLight.shadow.camera.top = 12;
        keyLight.shadow.camera.bottom = -12;

        // Cleaner shadow settings
        keyLight.shadow.radius = 1; // Reduced for cleaner edges
        keyLight.shadow.bias = -0.001; // Better for detailed models

        scene.add(keyLight);

        // 3. FILL LIGHT - Soft, shadow-less light from left
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.25);
        fillLight.position.set(-10, 8, 0);
        fillLight.castShadow = false; // No shadows from fill light
        scene.add(fillLight);

        // 4. RIM/BACK LIGHT - Subtle edge highlight
        const rimLight = new THREE.DirectionalLight(0x88aaff, 0.15); // Slight blue tint
        rimLight.position.set(-5, 5, -15);
        rimLight.castShadow = false;
        scene.add(rimLight);

        // 5. FRONT ACCENT LIGHT - Specifically for hand details
        const frontLight = new THREE.DirectionalLight(0xffffff, 0.2);
        frontLight.position.set(0, 5, 10);
        frontLight.castShadow = false;
        scene.add(frontLight);

        // Add this AFTER setting up the lights, but BEFORE loading the model:

        // ============================================
        // SHADOW RECEIVING GROUND PLANE
        // ============================================
        // Creates a clean surface for shadows to fall on

        // Create a subtle ground plane for shadows
        const groundGeometry = new THREE.PlaneGeometry(40, 40);
        const groundMaterial = new THREE.ShadowMaterial({
            color: 0x000000,
            opacity: 0.15, // Very subtle shadow
            transparent: true
        });

        const groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
        groundPlane.rotation.x = -Math.PI / 2; // Make it horizontal
        groundPlane.position.y = -2; // Position below the arm
        groundPlane.receiveShadow = true; // Important: receives shadows
        groundPlane.castShadow = false; // Doesn't cast shadows
        scene.add(groundPlane);

        // Optional: Add a subtle grid for spatial reference (disable if too distracting)
        const gridHelper = new THREE.GridHelper(160, 100, 0x444444, 0x222222);
        gridHelper.position.y = -0.01;
        scene.add(gridHelper);

        // Add axes helper at origin, centered with arm, longer lines for better visibility
        const axesHelper = new THREE.AxesHelper(80);
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

                            // Enable shadows on all arm meshes
                            child.castShadow = true;
                            child.receiveShadow = true;

                            // IMPORTANT: Improve material for better shadow response
                            if (child.material) {
                                if (Array.isArray(child.material)) {
                                    child.material.forEach(mat => {
                                        if (mat) {
                                            // More realistic material settings
                                            mat.color.setHex(0xe0e0e0); // Light gray
                                            mat.roughness = 0.4; // Less rough = more reflection
                                            mat.metalness = 0.05; // Very slight metallic sheen

                                            // Ensure materials update properly
                                            mat.needsUpdate = true;

                                            // Add subtle specular highlights
                                            if (mat.specular !== undefined) {
                                                mat.specular.setHex(0x111111);
                                            }
                                        }
                                    });
                                } else {
                                    // Single material
                                    child.material.color.setHex(0xe0e0e0);
                                    child.material.roughness = 0.4;
                                    child.material.metalness = 0.05;
                                    child.material.needsUpdate = true;

                                    if (child.material.specular !== undefined) {
                                        child.material.specular.setHex(0x111111);
                                    }
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
                    fingerMeshes.index.base = findMeshByName('Index3_1_1') || findMeshByName('Index3_1');
                    fingerMeshes.index.mid = findMeshByName('Index2_1_1') || findMeshByName('Index2_1');
                    fingerMeshes.index.tip = findMeshByName('Index1_1');

                    // MIDDLE FINGER (parent groups: Midle3_1_1, Midle2_1_1, Middle1_1) - note spelling!
                    fingerMeshes.middle.base = findMeshByName('Midle3_1_1') || findMeshByName('Middle3_1_1') || findMeshByName('Middle3_1');
                    fingerMeshes.middle.mid = findMeshByName('Midle2_1_1') || findMeshByName('Middle2_1_1') || findMeshByName('Middle2_1');
                    fingerMeshes.middle.tip = findMeshByName('Middle1_1');

                    // PINKY FINGER (parent groups: Pinky3_1_1, Pinky2_1, Pinky1_1)
                    fingerMeshes.pinky.base = findMeshByName('Pinky3_1_1') || findMeshByName('Pinky3_1');
                    fingerMeshes.pinky.mid = findMeshByName('Pinky2_1');
                    fingerMeshes.pinky.tip = findMeshByName('Pinky1_1');

                    // RING FINGER (parent groups: Ring3_1_1, Ring2_1, Ring1_1)
                    fingerMeshes.ring.base = findMeshByName('Ring3_1_1') || findMeshByName('Ring3_1');
                    fingerMeshes.ring.mid = findMeshByName('Ring2_1');
                    fingerMeshes.ring.tip = findMeshByName('Ring1_1');

                    // THUMB (parent groups: Thumb3_1_1, Thumb2_1_1, Thumb1_1)
                    fingerMeshes.thumb.base = findMeshByName('Thumb3_1_1') || findMeshByName('Thumb3_1');
                    fingerMeshes.thumb.mid = findMeshByName('Thumb2_1_1') || findMeshByName('Thumb2_1');
                    fingerMeshes.thumb.tip = findMeshByName('Thumb1_1');

                    // Summary of finger search results
                    const fingerResults = {
                        'Index3 (Index3_1_1)': fingerMeshes.index.base,
                        'Index2 (Index2_1_1)': fingerMeshes.index.mid,
                        'Index1 (Index1_1)': fingerMeshes.index.tip,
                        'Middle3 (Midle3_1_1)': fingerMeshes.middle.base,
                        'Middle2 (Midle2_1_1)': fingerMeshes.middle.mid,
                        'Middle1 (Middle1_1)': fingerMeshes.middle.tip,
                        'Pinky3 (Pinky3_1_1)': fingerMeshes.pinky.base,
                        'Pinky2 (Pinky2_1)': fingerMeshes.pinky.mid,
                        'Pinky1 (Pinky1_1)': fingerMeshes.pinky.tip,
                        'Ring3 (Ring3_1_1)': fingerMeshes.ring.base,
                        'Ring2 (Ring2_1)': fingerMeshes.ring.mid,
                        'Ring1 (Ring1_1)': fingerMeshes.ring.tip,
                        'Thumb3 (Thumb3_1_1)': fingerMeshes.thumb.base,
                        'Thumb2 (Thumb2_1_1)': fingerMeshes.thumb.mid,
                        'Thumb1 (Thumb1_1)': fingerMeshes.thumb.tip
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
                    const allFoundFingers = [
                        fingerMeshes.index.base, fingerMeshes.index.mid, fingerMeshes.index.tip,
                        fingerMeshes.middle.base, fingerMeshes.middle.mid, fingerMeshes.middle.tip,
                        fingerMeshes.pinky.base, fingerMeshes.pinky.mid, fingerMeshes.pinky.tip,
                        fingerMeshes.ring.base, fingerMeshes.ring.mid, fingerMeshes.ring.tip,
                        fingerMeshes.thumb.base, fingerMeshes.thumb.mid, fingerMeshes.thumb.tip
                    ].filter(f => f !== null);

                    allFoundFingers.forEach(finger => {
                    });

                    // Log found objects
                    const armObjects = [Mbajtesi_1, Shoulder_1, Biceps_up_1, Biceps_low_1, Forearm_1, Palm_1,
                        fingerMeshes.index.base, fingerMeshes.index.mid, fingerMeshes.index.tip,
                        fingerMeshes.middle.base, fingerMeshes.middle.mid, fingerMeshes.middle.tip,
                        fingerMeshes.pinky.base, fingerMeshes.pinky.mid, fingerMeshes.pinky.tip,
                        fingerMeshes.ring.base, fingerMeshes.ring.mid, fingerMeshes.ring.tip,
                        fingerMeshes.thumb.base, fingerMeshes.thumb.mid, fingerMeshes.thumb.tip];

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
                        fingerMeshes.index.base, fingerMeshes.index.mid, fingerMeshes.index.tip,
                        fingerMeshes.middle.base, fingerMeshes.middle.mid, fingerMeshes.middle.tip,
                        fingerMeshes.pinky.base, fingerMeshes.pinky.mid, fingerMeshes.pinky.tip,
                        fingerMeshes.ring.base, fingerMeshes.ring.mid, fingerMeshes.ring.tip,
                        fingerMeshes.thumb.base, fingerMeshes.thumb.mid, fingerMeshes.thumb.tip
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
        activeSliders.length = 0;  // Clear existing array

        for (let i = 0; i < sliders.length; i++) {
            const label = sliders[i].querySelector('.slider-label');
            const slider = sliders[i].querySelector('.slider');

            if (label && label.textContent.trim() !== 'N/A' && slider && !slider.disabled) {
                activeSliders.push(slider);
            }
        }

        console.log(`Found ${activeSliders.length} active sliders for movement control`);

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
            // ============================================
            // REGISTER FINGER SEGMENTS FOR CURLING SYSTEM
            // ============================================
            // Create finger segments object for registration

            // Register the finger segments
            registerFingerSegments(fingerMeshes);

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

        const MOVEMENT_SPEED = 50; // degrees per second (matches reset animation speed)

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
            const radianDisplay = slider.parentElement.querySelector('.radian-display');
            if (radianDisplay) {
                const radianValue = animation.currentValue * (Math.PI / 180);
                radianDisplay.textContent = `${radianValue.toFixed(2)} rad`;
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
            // Convert to radians and update radian display
            const radianValue = parseFloat(this.value) * (Math.PI / 180);
            const radianDisplay = this.parentElement.querySelector('.radian-display');
            if (radianDisplay) {
                radianDisplay.textContent = `${radianValue.toFixed(2)} rad`;
            }
            startSliderAnimation(0, this, displayElement, rotateElbow, 'Elbow');
            // Publish to MQTT - will be converted to "2" in publishSliderValue
            publishSliderValue('Elbow', parseFloat(this.value));
        });

        // Slider 1: BICEPS - Controls Biceps_low_1 rotation
        // Moves: Biceps_low_1, Forearm_1, Palm_1, and all finger joints
        if (activeSliders[1]) {
            activeSliders[1].addEventListener('input', function () {
                const displayElement = this.parentElement.querySelector('.slider-value-display');
                // Convert to radians and update radian display
                const radianValue = parseFloat(this.value) * (Math.PI / 180);
                const radianDisplay = this.parentElement.querySelector('.radian-display');
                if (radianDisplay) {
                    radianDisplay.textContent = `${radianValue.toFixed(2)} rad`;
                }
                startSliderAnimation(1, this, displayElement, rotateBiceps, 'Biceps');
                // Publish to MQTT - will be converted to "5" in publishSliderValue
                publishSliderValue('Biceps', parseFloat(this.value));
            });
        }

        // Slider 2: SHOULDER - Controls Shoulder_1 rotation
        // Moves: Shoulder_1 and entire arm (Y-axis rotation)
        // Inverted: slider 0 (left) = 0°, slider 90 (right) = -90°
        if (activeSliders[2]) {
            activeSliders[2].addEventListener('input', function () {
                const displayElement = this.parentElement.querySelector('.slider-value-display');
                const invertedSlider = {
                    value: -parseFloat(this.value)  // Invert the value
                };
                if (displayElement) {
                    displayElement.textContent = invertedSlider.value.toFixed(1) + '°';
                }
                // Convert to radians and update radian display
                const radianValue = invertedSlider.value * (Math.PI / 180);
                const radianDisplay = this.parentElement.querySelector('.radian-display');
                if (radianDisplay) {
                    radianDisplay.textContent = `${radianValue.toFixed(2)} rad`;
                }
                sliderAnimations[2].targetValue = invertedSlider.value;
                if (!sliderAnimations[2].isAnimating) {
                    sliderAnimations[2].isAnimating = true;
                    sliderAnimations[2].lastTime = Date.now();
                    animateSliderToTarget(2, this, displayElement, rotateShoulder, 'Shoulder');
                }
                // Publish to MQTT - will be converted to "3" in publishSliderValue
                publishSliderValue('Shoulder', invertedSlider.value);
            });
        }

        // Slider 3: SHOULDER BLADE - Controls Biceps_up_1 rotation
        // Moves: Biceps_up_1, Biceps_low_1, Forearm_1, Palm_1, and all finger joints (X-axis forward/back)
        if (activeSliders[3]) {
            activeSliders[3].addEventListener('input', function () {
                const displayElement = this.parentElement.querySelector('.slider-value-display');
                // Convert to radians and update radian display
                const radianValue = parseFloat(this.value) * (Math.PI / 180);
                const radianDisplay = this.parentElement.querySelector('.radian-display');
                if (radianDisplay) {
                    radianDisplay.textContent = `${radianValue.toFixed(2)} rad`;
                }
                startSliderAnimation(3, this, displayElement, rotateShoulderBlade, 'Shoulder Blade');
                // Publish to MQTT - will be converted to "4" in publishSliderValue
                publishSliderValue('ShoulderBlade', parseFloat(this.value));
            });
        }

        // Reset button functionality
        const resetBtn = document.getElementById('resetSlidersBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                activeSliders.forEach((slider, index) => {
                    sliderAnimations[index].targetValue = 0;
                    // Update radian display for reset
                    const radianValue = 0 * (Math.PI / 180);
                    const radianDisplay = slider.parentElement.querySelector('.radian-display');
                    if (radianDisplay) {
                        radianDisplay.textContent = `${radianValue.toFixed(2)} rad`;
                    }
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

        // ============================================
        // CLEAR CONSOLE FUNCTIONALITY
        // ============================================

        function setupClearConsoleButton() {
            const clearConsoleBtn = document.getElementById('clearConsoleBtn');
            if (!clearConsoleBtn) {
                console.warn('Clear Console button not found in HTML');
                return;
            }

            clearConsoleBtn.addEventListener('click', function () {
                console.clear();
                console.log('✅ Console cleared at ' + new Date().toLocaleTimeString());

                // Optional: Visual feedback
                const originalText = clearConsoleBtn.textContent;
                // clearConsoleBtn.textContent = '✓ Cleared!';
                // clearConsoleBtn.style.backgroundColor = '#28a745';

                // Reset button after 1 second
                setTimeout(() => {
                    clearConsoleBtn.textContent = originalText;
                    clearConsoleBtn.style.backgroundColor = '';
                }, 1000);
            });
        }

        // Call this function when the DOM is ready
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(() => {
                setupClearConsoleButton();
            }, 500);
        });

        // ============================================
        // GLOBAL MOVEMENT LOCK SYSTEM
        // ============================================
        // Prevents multiple movement sequences from interfering with each other
        let movementLock = false;
        let currentMovementType = null; // 'arm', 'grabWater', 'hello', etc.

        // ============================================
        // SLIDER CONTROL UTILITY FUNCTIONS
        // ============================================

        // Track if any movement is active
        let isMovementActive = false;

        // Function to start any movement sequence
        function startMovementSequence(movementType = 'arm') {
            // Check if another movement is already active
            if (movementLock) {
                console.warn(`⚠ Cannot start ${movementType} movement - ${currentMovementType || 'another'} movement is already active`);
                return false;
            }

            movementLock = true;
            currentMovementType = movementType;
            isMovementActive = true;

            disableAllSliders();
            disableFingerButtons();

            // Add visual indicator
            const statusElement = document.getElementById('mqttStatus');
            if (statusElement) {
                statusElement.textContent = `🟡 ${movementType.charAt(0).toUpperCase() + movementType.slice(1)} Movement Active`;
                statusElement.style.color = '#ff9900';
            }

            return true;
        }

        // Function to end any movement sequence
        function endMovementSequence() {
            movementLock = false;
            currentMovementType = null;
            isMovementActive = false;

            enableAllSliders();
            enableFingerButtons();

            // Restore MQTT status
            if (mqttClient && mqttClient.connected) {
                const statusElement = document.getElementById('mqttStatus');
                if (statusElement) {
                    statusElement.textContent = '🟢 Connected to MQTT';
                    statusElement.style.color = '#00ff00';
                }
            }

            // Remove active class from all movement buttons
            const movementBtns = document.querySelectorAll('.movement-btn');
            movementBtns.forEach(btn => {
                btn.classList.remove('active');
            });
        }
        // ============================================
        // ARM MOVEMENT BUTTON FUNCTIONALITY
        // ============================================

        const armMovementBtn = document.getElementById('armMovementBtn');
        if (armMovementBtn) {
            armMovementBtn.addEventListener('click', function () {
                console.log('💪 Starting Arm Movement sequence');

                // Check if movement can start
                if (!startMovementSequence('arm')) {
                    return;
                }

                // Visual feedback
                armMovementBtn.classList.add('active');

                // Disable button during animation
                armMovementBtn.disabled = true;
                armMovementBtn.textContent = 'Moving...';

                // Execute the arm movement sequence
                executeArmMovementSequence(0); // Start with first iteration
            });
        }

        function executeArmMovementSequence(iteration) {
            // Make sure we still have the lock
            if (currentMovementType !== 'arm') {
                console.warn('Arm movement interrupted');
                return;
            }
            console.log(`Arm Movement iteration ${iteration + 1}/5`);

            // Define the movement sequence
            const sequence = [
                // Step 1: Elbow to 101.7° (1.7750 rad)
                { joint: 'Elbow', value: 101.7, index: 0, rotateFunc: rotateElbow },

                // Step 2: Shoulder to -77.0° (-1.3439 rad)
                { joint: 'Shoulder', value: -77.0, index: 2, rotateFunc: rotateShoulder },

                // Step 3: Shoulder Blade to 80° (1.390 rad)
                { joint: 'ShoulderBlade', value: 80, index: 3, rotateFunc: rotateShoulderBlade },

                // Step 4: Biceps to 38.7° (0.6754 rad)
                { joint: 'Biceps', value: 38.7, index: 1, rotateFunc: rotateBiceps },

                // Step 5: Elbow to 60° (1.0507 rad)
                { joint: 'Elbow', value: 60, index: 0, rotateFunc: rotateElbow },

                // Step 6: Shoulder to -39.3° (0.6859 rad)
                { joint: 'Shoulder', value: -39.3, index: 2, rotateFunc: rotateShoulder },

                // Step 7: Shoulder Blade to 0° (0.0 rad)
                { joint: 'ShoulderBlade', value: 0, index: 3, rotateFunc: rotateShoulderBlade },

                // Step 8: Biceps to 0° (0.0 rad)
                { joint: 'Biceps', value: 0, index: 1, rotateFunc: rotateBiceps }
            ];

            // Execute sequence step by step
            executeArmSequenceStep(sequence, 0, iteration);
        }

        function executeArmSequenceStep(sequence, stepIndex, iteration) {
            if (stepIndex >= sequence.length) {
                // This iteration is complete
                if (iteration < 4) {
                    // Loop 4 more times (total 5)
                    setTimeout(() => {
                        executeArmMovementSequence(iteration + 1);
                    }, 500); // Small delay between iterations
                } else {
                    // All iterations complete, reset arm
                    console.log('✅ Arm Movement iterations complete, resetting arm...');
                    resetArmAfterMovement();
                }
                return;
            }

            const movement = sequence[stepIndex];
            console.log(`  Step ${stepIndex + 1}: Moving ${movement.joint} to ${movement.value}°`);

            // Set target value
            sliderAnimations[movement.index].targetValue = movement.value;

            // Update slider visual position
            if (activeSliders[movement.index]) {
                if (movement.joint === 'Shoulder') {
                    activeSliders[movement.index].value = -movement.value; // Invert for shoulder display
                } else {
                    activeSliders[movement.index].value = movement.value;
                }
            }

            // Start animation
            if (!sliderAnimations[movement.index].isAnimating) {
                sliderAnimations[movement.index].isAnimating = true;
                sliderAnimations[movement.index].lastTime = Date.now();

                const displayElement = activeSliders[movement.index]?.parentElement?.querySelector('.slider-value-display');

                // Map joint name for MQTT publication
                const mqttJointMap = {
                    'Elbow': 'Brryli',
                    'Biceps': 'Biceps',
                    'Shoulder': 'Krahu',
                    'ShoulderBlade': 'Mbajtesi'
                };

                const mqttLabel = mqttJointMap[movement.joint] || movement.joint;

                animateSliderToTarget(
                    movement.index,
                    activeSliders[movement.index],
                    displayElement,
                    movement.rotateFunc,
                    mqttLabel
                );
            }

            // Wait for movement to complete
            const checkComplete = () => {
                const anim = sliderAnimations[movement.index];
                if (Math.abs(anim.targetValue - anim.currentValue) <= 0.1 || !anim.isAnimating) {
                    // Move to next step after delay
                    setTimeout(() => {
                        executeArmSequenceStep(sequence, stepIndex + 1, iteration);
                    }, 300); // Delay between steps
                } else {
                    setTimeout(checkComplete, 100);
                }
            };

            setTimeout(checkComplete, 100);
        }

        function resetArmAfterMovement() {
            console.log('Resetting arm to 0° position...');

            // Reset all sliders to 0° using existing reset system
            activeSliders.forEach((slider, index) => {
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

            // Wait for reset to complete
            const checkResetComplete = () => {
                const allComplete = sliderAnimations.every(anim =>
                    Math.abs(anim.targetValue - anim.currentValue) <= 0.1 || !anim.isAnimating
                );

                if (allComplete) {
                    console.log('✅ Arm Movement sequence complete!');

                    // Re-enable controls
                    endMovementSequence();

                    if (armMovementBtn) {
                        armMovementBtn.disabled = false;
                        armMovementBtn.textContent = 'Arm Movement';
                    }
                } else {
                    setTimeout(checkResetComplete, 500);
                }
            };

            setTimeout(checkResetComplete, 500);
        }

        // ============================================
        // GRAB WATER BUTTON FUNCTIONALITY
        // ============================================

        const grabWaterBtn = document.getElementById('grabWaterBtn');
        if (grabWaterBtn) {
            grabWaterBtn.addEventListener('click', function () {
                console.log('💧 Starting Grab Water sequence');

                // Check if movement can start
                if (!startMovementSequence('grabWater')) {
                    return;
                }

                // Disable button during animation
                grabWaterBtn.disabled = true;
                grabWaterBtn.textContent = 'Grabbing...';

                // Execute the complete Grab Water sequence
                executeGrabWaterSequence();
            });
        }

        function executeGrabWaterSequence() {
            console.log('1. Starting grab sequence');

            // Step 1: Elbow to 98.5°
            moveJoint('Elbow', 98.5, 0, rotateElbow, function () {
                // Step 2: Biceps to 25.3°
                moveJoint('Biceps', 25.3, 1, rotateBiceps, function () {
                    // Step 3: Elbow to 84.4°
                    moveJoint('Elbow', 84.4, 0, rotateElbow, function () {
                        // Step 4: Close all fingers and wait 3 seconds
                        console.log('4. Closing all fingers');
                        closeAllFingers(function () {
                            setTimeout(function () {
                                // Step 5: Elbow to 104.6°
                                moveJoint('Elbow', 104.6, 0, rotateElbow, function () {
                                    // Step 6: Biceps to -5°
                                    moveJoint('Biceps', -5, 1, rotateBiceps, function () {
                                        // Step 7: Elbow to 0°
                                        moveJoint('Elbow', 0, 0, rotateElbow, function () {
                                            // Wait 5 seconds
                                            setTimeout(function () {
                                                console.log('8. Starting pour sequence');
                                                // Step 8: Elbow to 104.6°
                                                moveJoint('Elbow', 104.6, 0, rotateElbow, function () {
                                                    // Step 9: Biceps to 25.3°
                                                    moveJoint('Biceps', 25.3, 1, rotateBiceps, function () {
                                                        // Step 10: Elbow to 84.4°
                                                        moveJoint('Elbow', 84.4, 0, rotateElbow, function () {
                                                            // Step 11: Open fingers
                                                            console.log('11. Opening fingers');
                                                            openAllFingers(function () {
                                                                // Step 12: Elbow to 104.6°
                                                                moveJoint('Elbow', 104.6, 0, rotateElbow, function () {
                                                                    // Step 13: Biceps to -5°
                                                                    moveJoint('Biceps', -5, 1, rotateBiceps, function () {
                                                                        // Step 14: Elbow to 0°
                                                                        moveJoint('Elbow', 0, 0, rotateElbow, function () {
                                                                            // Step 15: Biceps to 0° (final reset)
                                                                            moveJoint('Biceps', 0, 1, rotateBiceps, function () {
                                                                                // Sequence complete
                                                                                console.log('✅ Grab Water sequence complete');
                                                                                endMovementSequence();
                                                                                if (grabWaterBtn) {
                                                                                    grabWaterBtn.disabled = false;
                                                                                    grabWaterBtn.textContent = 'Grab Water';
                                                                                }
                                                                            });
                                                                        });
                                                                    });
                                                                });
                                                            });
                                                        });
                                                    });
                                                });
                                            }, 5000); // Wait 5 seconds
                                        });
                                    });
                                });
                            }, 3000); // Wait 3 seconds with closed fingers
                        });
                    });
                });
            });
        }

        // Helper function to move a joint
        function moveJoint(jointName, targetValue, sliderIndex, rotateFunction, callback) {
            console.log(`  Moving ${jointName} to ${targetValue}°`);

            // Set target value
            sliderAnimations[sliderIndex].targetValue = targetValue;

            // Update slider visual position
            if (activeSliders[sliderIndex]) {
                if (jointName === 'Shoulder') {
                    activeSliders[sliderIndex].value = -targetValue; // Invert for shoulder
                } else {
                    activeSliders[sliderIndex].value = targetValue;
                }
            }

            // Start animation
            if (!sliderAnimations[sliderIndex].isAnimating) {
                sliderAnimations[sliderIndex].isAnimating = true;
                sliderAnimations[sliderIndex].lastTime = Date.now();

                const displayElement = activeSliders[sliderIndex]?.parentElement?.querySelector('.slider-value-display');

                // Map joint name for MQTT publication
                const mqttJointMap = {
                    'Elbow': '2',
                    'Biceps': '5',
                    'Shoulder': '3',
                    'ShoulderBlade': '4'
                };

                const mqttLabel = mqttJointMap[jointName] || jointName;

                animateSliderToTarget(
                    sliderIndex,
                    activeSliders[sliderIndex],
                    displayElement,
                    rotateFunction,
                    mqttLabel
                );
            }

            // Wait for completion
            const checkComplete = () => {
                const anim = sliderAnimations[sliderIndex];
                if (Math.abs(anim.targetValue - anim.currentValue) <= 0.1 || !anim.isAnimating) {
                    // Add small delay before next movement
                    setTimeout(callback, 500);
                } else {
                    setTimeout(checkComplete, 100);
                }
            };

            setTimeout(checkComplete, 100);
        }

        // Function to close all fingers
        function closeAllFingers(callback) {
            // Find the Close Fingers button and simulate click
            const closeAllBtn = document.querySelector('.finger-btn');
            let foundCloseBtn = null;

            document.querySelectorAll('.finger-btn').forEach(btn => {
                if (btn.textContent.trim() === 'Close Fingers') {
                    foundCloseBtn = btn;
                }
            });

            if (foundCloseBtn) {
                foundCloseBtn.click();

                // Also close individual fingers to ensure visual feedback
                const individualFingerBtns = document.querySelectorAll('.individual-finger-btn');
                individualFingerBtns.forEach(btn => {
                    const text = btn.textContent.trim();
                    if (text === 'Move Index' || text === 'Move Middle' ||
                        text === 'Move Ring' || text === 'Move Pinky') {
                        if (!btn.classList.contains('active')) {
                            btn.click();
                        }
                    }
                });
            }

            // Wait a moment for fingers to close
            setTimeout(callback, 1000);
        }

        // Function to open all fingers
        function openAllFingers(callback) {
            // Find the Open Fingers button and simulate click
            const openAllBtn = document.querySelector('.finger-btn');
            let foundOpenBtn = null;

            document.querySelectorAll('.finger-btn').forEach(btn => {
                if (btn.textContent.trim() === 'Open Fingers') {
                    foundOpenBtn = btn;
                }
            });

            if (foundOpenBtn) {
                foundOpenBtn.click();

                // Also open individual fingers to ensure visual feedback
                const individualFingerBtns = document.querySelectorAll('.individual-finger-btn');
                individualFingerBtns.forEach(btn => {
                    const text = btn.textContent.trim();
                    if (text === 'Move Index' || text === 'Move Middle' ||
                        text === 'Move Ring' || text === 'Move Pinky') {
                        if (btn.classList.contains('active')) {
                            btn.click();
                        }
                    }
                });
            }

            // Wait a moment for fingers to open
            setTimeout(callback, 1000);
        }

        // ============================================
        // HELLO MOVEMENT BUTTON FUNCTIONALITY
        // ============================================

        const helloMovementBtn = document.getElementById('helloMovementBtn');
        if (helloMovementBtn) {
            helloMovementBtn.addEventListener('click', function () {
                console.log('👋 Starting Hello Movement sequence');

                // Check if movement can start
                if (!startMovementSequence('hello')) {
                    return;
                }

                // Disable button during animation
                helloMovementBtn.disabled = true;
                helloMovementBtn.textContent = 'Moving...';

                // Execute the complete sequence
                executeHelloSequence();
            });
        }

        function executeHelloSequence() {
            if (currentMovementType !== 'hello') {
                console.warn('Hello movement interrupted');
                return;
            }
            // STEP 1: Move to initial Hello position
            console.log('1. Moving to initial Hello position');

            const initialSequence = [
                { joint: 'Elbow', value: 100, index: 0, rotateFunc: rotateElbow },
                { joint: 'Shoulder', value: -79.6, index: 2, rotateFunc: rotateShoulder },
                { joint: 'ShoulderBlade', value: 77.1, index: 3, rotateFunc: rotateShoulderBlade },
                { joint: 'Biceps', value: -11.3, index: 1, rotateFunc: rotateBiceps },
            ];

            // Execute initial sequence
            executeSequenceStep(initialSequence, 0, function () {
                console.log('2. Starting wave motion (3 cycles)');
                startWaveMotion(0);
            });
        }

        function executeSequenceStep(sequence, stepIndex, callback) {
            if (stepIndex >= sequence.length) {
                if (callback) callback();
                return;
            }

            const movement = sequence[stepIndex];
            // console.log(`  Moving ${movement.joint} to ${movement.value}°`);

            // Set target
            sliderAnimations[movement.index].targetValue = movement.value;

            // Update slider display
            if (activeSliders[movement.index]) {
                if (movement.joint === 'Shoulder') {
                    activeSliders[movement.index].value = -movement.value; // Invert for shoulder
                } else {
                    activeSliders[movement.index].value = movement.value;
                }
            }

            // Start animation
            if (!sliderAnimations[movement.index].isAnimating) {
                sliderAnimations[movement.index].isAnimating = true;
                sliderAnimations[movement.index].lastTime = Date.now();

                const displayElement = activeSliders[movement.index]?.parentElement?.querySelector('.slider-value-display');

                animateSliderToTarget(
                    movement.index,
                    activeSliders[movement.index],
                    displayElement,
                    movement.rotateFunc,
                    movement.joint
                );
            }

            // Wait for completion
            const checkComplete = () => {
                const anim = sliderAnimations[movement.index];
                if (Math.abs(anim.targetValue - anim.currentValue) <= 0.1 || !anim.isAnimating) {
                    // Move to next step after delay
                    setTimeout(() => {
                        executeSequenceStep(sequence, stepIndex + 1, callback);
                    }, 500);
                } else {
                    setTimeout(checkComplete, 100);
                }
            };

            setTimeout(checkComplete, 100);
        }

        function startWaveMotion(waveCount) {
            if (waveCount >= 3) {
                // Done with waves, reset to initial wave position (80°)
                // console.log('3. Resetting to wave start position (80°)');
                resetToWaveStart(function () {
                    // STEP 4: Reset entire arm to start position (0°)
                    // console.log('4. Resetting entire arm to start position');
                    resetArmToStart();
                });
                return;
            }

            // console.log(`  Wave ${waveCount + 1}: 80° -> 110°`);

            // Move to 110°
            sliderAnimations[0].targetValue = 110;
            if (activeSliders[0]) activeSliders[0].value = 110;

            if (!sliderAnimations[0].isAnimating) {
                sliderAnimations[0].isAnimating = true;
                sliderAnimations[0].lastTime = Date.now();

                const displayElement = activeSliders[0]?.parentElement?.querySelector('.slider-value-display');
                animateSliderToTarget(0, activeSliders[0], displayElement, rotateElbow, 'Elbow');
            }

            // Wait for 110°
            const check110 = () => {
                const anim = sliderAnimations[0];
                if (Math.abs(anim.targetValue - anim.currentValue) <= 0.1 || !anim.isAnimating) {
                    setTimeout(() => {
                        console.log(`  Wave ${waveCount + 1}: 110° -> 80°`);

                        // Move to 80°
                        sliderAnimations[0].targetValue = 80;
                        if (activeSliders[0]) activeSliders[0].value = 80;

                        if (!sliderAnimations[0].isAnimating) {
                            sliderAnimations[0].isAnimating = true;
                            sliderAnimations[0].lastTime = Date.now();

                            const displayElement = activeSliders[0]?.parentElement?.querySelector('.slider-value-display');
                            animateSliderToTarget(0, activeSliders[0], displayElement, rotateElbow, 'Elbow');
                        }

                        // Wait for 80°
                        const check80 = () => {
                            const anim = sliderAnimations[0];
                            if (Math.abs(anim.targetValue - anim.currentValue) <= 0.1 || !anim.isAnimating) {
                                // Next wave
                                setTimeout(() => {
                                    startWaveMotion(waveCount + 1);
                                }, 300);
                            } else {
                                setTimeout(check80, 100);
                            }
                        };

                        setTimeout(check80, 100);
                    }, 300);
                } else {
                    setTimeout(check110, 100);
                }
            };

            setTimeout(check110, 100);
        }

        function resetToWaveStart(callback) {
            // Reset elbow to 80° (wave start position)
            sliderAnimations[0].targetValue = 80;
            if (activeSliders[0]) activeSliders[0].value = 80;

            if (!sliderAnimations[0].isAnimating) {
                sliderAnimations[0].isAnimating = true;
                sliderAnimations[0].lastTime = Date.now();

                const displayElement = activeSliders[0]?.parentElement?.querySelector('.slider-value-display');
                animateSliderToTarget(0, activeSliders[0], displayElement, rotateElbow, 'Elbow');
            }

            const checkReset = () => {
                const anim = sliderAnimations[0];
                if (Math.abs(anim.targetValue - anim.currentValue) <= 0.1 || !anim.isAnimating) {
                    setTimeout(callback, 500);
                } else {
                    setTimeout(checkReset, 100);
                }
            };

            setTimeout(checkReset, 100);
        }

        function resetArmToStart() {
            // Reset all sliders to 0° using existing reset system
            activeSliders.forEach((slider, index) => {
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

            // Wait for all to complete
            const checkAllComplete = () => {
                const allComplete = sliderAnimations.every(anim =>
                    Math.abs(anim.targetValue - anim.currentValue) <= 0.1 || !anim.isAnimating
                );

                if (allComplete) {
                    console.log('✅ Hello Movement sequence complete');

                    // Release movement lock and re-enable controls
                    endMovementSequence();

                    if (helloMovementBtn) {
                        helloMovementBtn.disabled = false;
                        helloMovementBtn.textContent = 'Hello Movement';
                    }
                } else {
                    setTimeout(checkAllComplete, 500);
                }
            };

            setTimeout(checkAllComplete, 500);
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
    // Initialize radian displays on page load
    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(() => {
            const sliders = document.querySelectorAll('.slider');
            sliders.forEach((slider) => {
                if (!slider.disabled) {
                    const degreeValue = parseFloat(slider.value);
                    const radianValue = degreeValue * (Math.PI / 180);
                    const radianDisplay = slider.parentElement.querySelector('.radian-display');
                    if (radianDisplay) {
                        radianDisplay.textContent = `${radianValue.toFixed(2)} rad`;
                    }
                }
            });
        }, 1000);
    });
})();
