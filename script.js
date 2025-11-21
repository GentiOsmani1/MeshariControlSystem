import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/loaders/STLLoader.js';
import { MeshoptDecoder } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/controls/OrbitControls.js';

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

// Function to publish slider values to MQTT broker
function publishSliderValue(sliderName, value) {
    if (!mqttClient || !mqttClient.connected) {
        console.log('⚠️ Not connected to MQTT broker');
        return;
    }
    
    // Convert degrees to radians
    const valueInRadians = value * (Math.PI / 180);
    
    // Send as: "Elbow", "0.7854"
    const message = '"' + sliderName + '", "' + valueInRadians.toFixed(4) + '"';
    
    mqttClient.publish(
        'meshari/sliders',              // Topic name
        message,                        // Message payload (plain string)
        { qos: 0 }                      // Quality of Service
    );
    
    console.log('📤 Published to MQTT:', message);
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

        console.log('Three.js initialized');
        console.log('OrbitControls enabled - use mouse to rotate camera');
        console.log('Container size:', container.clientWidth, 'x', container.clientHeight);

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

        /**
         * STEP 1 & 2: Analyze the GLB file structure to understand existing hierarchy
         * Maps out the entire arm hierarchy from the GLB file including bones, meshes, and joints
         * @param {THREE.Scene} glbScene - The loaded GLB scene
         * @returns {Map} - Map of joint names to their hierarchy information
         */
        function analyzeArmHierarchy(glbScene) {
            const jointMap = new Map();

            glbScene.traverse((object) => {
                if (object.isBone || object.name.includes('Shoulder') || object.name.includes('Biceps') ||
                    object.name.includes('Forearm') || object.name.includes('Palm') ||
                    object.name.includes('Index') || object.name.includes('Middle') ||
                    object.name.includes('Pinky') || object.name.includes('Ring') ||
                    object.name.includes('Thumb')) {

                    jointMap.set(object.name, {
                        object: object,
                        children: [],
                        parent: object.parent ? object.parent.name : null,
                        type: object.isBone ? 'Bone' : (object.isMesh ? 'Mesh' : object.type),
                        worldPosition: object.getWorldPosition ? object.getWorldPosition(new THREE.Vector3()).clone() : null,
                        worldRotation: object.getWorldQuaternion ? object.getWorldQuaternion(new THREE.Quaternion()).clone() : null,
                        worldScale: object.getWorldScale ? object.getWorldScale(new THREE.Vector3()).clone() : null
                    });
                }
            });

            // Build children relationships
            jointMap.forEach((joint, jointName) => {
                if (joint.parent && jointMap.has(joint.parent)) {
                    jointMap.get(joint.parent).children.push(jointName);
                }
            });

            // Log the analysis
            console.log('=== GLB HIERARCHY ANALYSIS ===');
            console.log(`Found ${jointMap.size} arm-related objects`);
            jointMap.forEach((joint, name) => {
                console.log(`  ${name}:`);
                console.log(`    Type: ${joint.type}`);
                console.log(`    Parent: ${joint.parent || 'ROOT'}`);
                console.log(`    Children: [${joint.children.join(', ') || 'none'}]`);
            });
            console.log('=== END HIERARCHY ANALYSIS ===');

            return jointMap;
        }

        /**
         * STEP 3 & 4: Compare GLB hierarchy with requirements and correct if needed
         * Preserves all world transformations, materials, animations, and visual properties
         * Only modifies parent-child relationships to ensure proper movement hierarchy
         * @param {THREE.Scene} glbScene - The loaded GLB scene
         */
        function correctHierarchyFromGLB(glbScene) {
            // Update matrices to get accurate world transforms
            glbScene.updateMatrixWorld(true);

            // Store current world transformations for all arm objects
            const worldPositions = new Map();
            const worldRotations = new Map();
            const worldScales = new Map();
            const worldMatrices = new Map();

            // Identify arm objects and store their world transforms
            // Use case-insensitive matching to catch all variations
            const armObjects = [];
            const namePatterns = ['shoulder', 'biceps', 'forearm', 'palm', 'index', 'middle', 'pinky', 'ring', 'thumb'];

            glbScene.traverse((object) => {
                if (!object.name) return;

                const objNameLower = object.name.toLowerCase();

                // Check if object name matches any arm-related pattern (case-insensitive)
                const matchesPattern = namePatterns.some(pattern => objNameLower.includes(pattern));

                if (matchesPattern) {
                    armObjects.push(object);

                    // Store world transforms
                    const worldPos = new THREE.Vector3();
                    const worldQuat = new THREE.Quaternion();
                    const worldScale = new THREE.Vector3();

                    object.updateMatrixWorld();
                    object.getWorldPosition(worldPos);
                    object.getWorldQuaternion(worldQuat);
                    object.getWorldScale(worldScale);

                    worldPositions.set(object, worldPos.clone());
                    worldRotations.set(object, worldQuat.clone());
                    worldScales.set(object, worldScale.clone());
                    worldMatrices.set(object, object.matrixWorld.clone());
                }
            });

            console.log(`=== CORRECTING HIERARCHY FOR ${armObjects.length} OBJECTS ===`);

            // Log all arm objects found for debugging
            console.log('Arm objects found:', armObjects.map(obj => ({
                name: obj.name || 'unnamed',
                type: obj.type,
                isMesh: obj.isMesh,
                isBone: obj.isBone,
                visible: obj.visible,
                parent: obj.parent ? (obj.parent.name || 'unnamed') : 'none'
            })));

            // Also log ALL meshes in the scene to ensure nothing is missed
            const allMeshes = [];
            glbScene.traverse((object) => {
                if (object.isMesh) {
                    allMeshes.push({
                        name: object.name || 'unnamed',
                        visible: object.visible,
                        parent: object.parent ? (object.parent.name || 'unnamed') : 'scene root'
                    });
                }
            });
            console.log(`Total meshes in scene: ${allMeshes.length}`);
            console.log('All meshes:', allMeshes);

            // Find objects by name (prefer meshes, but also check bones/groups)
            // Uses flexible matching to handle name variations
            const findObjectByName = (name) => {
                const nameLower = name.toLowerCase();

                // First try exact match in armObjects
                let found = armObjects.find(obj => obj.name === name);
                if (found) return found;

                // Try case-insensitive exact match
                found = armObjects.find(obj => obj.name && obj.name.toLowerCase() === nameLower);
                if (found) return found;

                // Try partial match (contains)
                found = armObjects.find(obj => obj.name && obj.name.toLowerCase().includes(nameLower));
                if (found) {
                    console.log(`Found ${name} as partial match: "${found.name}"`);
                    return found;
                }

                // Try reverse partial match (name contains search term)
                found = armObjects.find(obj => obj.name && nameLower.includes(obj.name.toLowerCase()));
                if (found) {
                    console.log(`Found ${name} as reverse partial match: "${found.name}"`);
                    return found;
                }

                // If not found in armObjects, search the entire scene with flexible matching
                let result = null;
                glbScene.traverse((object) => {
                    if (result) return;
                    if (!object.name) return;

                    const objNameLower = object.name.toLowerCase();

                    // Exact match
                    if (object.name === name || objNameLower === nameLower) {
                        result = object;
                        return;
                    }

                    // Partial match (object name contains search term)
                    if (objNameLower.includes(nameLower)) {
                        result = object;
                        console.log(`Found ${name} in scene as partial match: "${object.name}"`);
                        return;
                    }

                    // Reverse partial match (search term contains object name)
                    if (nameLower.includes(objNameLower) && objNameLower.length > 3) {
                        result = object;
                        console.log(`Found ${name} in scene as reverse partial match: "${object.name}"`);
                        return;
                    }
                });

                if (!result) {
                    console.warn(`⚠ Could not find object: ${name}`);
                    // Log similar names for debugging
                    const similarNames = [];
                    glbScene.traverse((object) => {
                        if (object.name && object.name.toLowerCase().includes(nameLower.substring(0, 3))) {
                            similarNames.push(object.name);
                        }
                    });
                    if (similarNames.length > 0) {
                        console.log(`  Similar names found:`, similarNames);
                    }
                }

                return result;
            };

            // Rebuild hierarchy based on GLB analysis and requirements
            // STEP 4: Establish proper parent-child relationships while preserving world transforms
            // Only modify the specific objects we need for the hierarchy chain
            const shoulder = findObjectByName('Shoulder_1');
            const bicepsUp = findObjectByName('Biceps_up_1');
            const bicepsLow = findObjectByName('Biceps_low_1');
            const forearm = findObjectByName('Forearm_1');
            const palm = findObjectByName('Palm_1');

            // Use the world matrices we already stored (before any reparenting)
            // These preserve the original world positions

            // Only remove objects from parents if we're going to reparent them
            // This ensures all other objects stay in their original positions
            if (bicepsUp && bicepsUp.parent !== shoulder) {
                if (bicepsUp.parent) bicepsUp.parent.remove(bicepsUp);
                if (shoulder) {
                    shoulder.add(bicepsUp);
                    console.log('✓ Shoulder_1 -> Biceps_up_1');
                }
            }

            if (bicepsLow && bicepsLow.parent !== bicepsUp) {
                if (bicepsLow.parent) bicepsLow.parent.remove(bicepsLow);
                if (bicepsUp) {
                    bicepsUp.add(bicepsLow);
                    console.log('✓ Biceps_up_1 -> Biceps_low_1');
                }
            }

            if (forearm && forearm.parent !== bicepsLow) {
                if (forearm.parent) forearm.parent.remove(forearm);
                if (bicepsLow) {
                    bicepsLow.add(forearm);
                    console.log('✓ Biceps_low_1 -> Forearm_1');
                }
            }

            if (palm && palm.parent !== forearm) {
                if (palm.parent) palm.parent.remove(palm);
                if (forearm) {
                    forearm.add(palm);
                    console.log('✓ Forearm_1 -> Palm_1');
                }
            }

            // Parent all finger segments to palm (all 3 segments per finger)
            const fingerNames = [
                'Index3_1', 'Index2_1', 'Index1_1',
                'Middle3_1', 'Middle2_1', 'Middle1_1',
                'Pinky3_1', 'Pinky2_1', 'Pinky1_1',
                'Ring3_1', 'Ring2_1', 'Ring1_1',
                'Thumb3_1', 'Thumb2_1', 'Thumb1_1'
            ];
            const fingerObjects = [];
            const foundFingers = [];
            const missingFingers = [];

            console.log('=== SEARCHING FOR FINGER OBJECTS ===');
            fingerNames.forEach(fingerName => {
                const finger = findObjectByName(fingerName);
                if (finger) {
                    foundFingers.push({ searched: fingerName, found: finger.name, object: finger });
                    if (palm && finger.parent !== palm) {
                        // Make sure we have the world matrix stored before reparenting
                        if (!worldMatrices.has(finger)) {
                            finger.updateMatrixWorld();
                            worldMatrices.set(finger, finger.matrixWorld.clone());
                        }
                        if (finger.parent) finger.parent.remove(finger);
                        palm.add(finger);
                        fingerObjects.push(finger);
                        console.log(`✓ Found and parented ${fingerName} (actual name: "${finger.name}") to Palm_1`);
                    } else if (!palm) {
                        console.warn(`⚠ Found ${fingerName} but Palm_1 is missing`);
                    } else {
                        console.log(`✓ ${fingerName} already parented to Palm_1`);
                        fingerObjects.push(finger);
                    }
                } else {
                    missingFingers.push(fingerName);
                }
            });

            console.log(`=== FINGER SEARCH RESULTS ===`);
            console.log(`Found: ${foundFingers.length}/${fingerNames.length} fingers`);
            foundFingers.forEach(f => console.log(`  ✓ ${f.searched} -> "${f.found}"`));
            if (missingFingers.length > 0) {
                console.log(`Missing: ${missingFingers.length} fingers:`, missingFingers);
                // Try to find any objects with similar names
                missingFingers.forEach(missingName => {
                    const searchTerm = missingName.toLowerCase().replace(/_/g, '').substring(0, 5);
                    const similar = [];
                    glbScene.traverse((object) => {
                        if (object.name && object.name.toLowerCase().includes(searchTerm)) {
                            similar.push(object.name);
                        }
                    });
                    if (similar.length > 0) {
                        console.log(`  Similar to ${missingName}:`, similar);
                    }
                });
            }

            if (fingerObjects.length > 0) {
                console.log(`✓ Palm_1 -> ${fingerObjects.length} finger segments`);
            } else if (palm) {
                console.warn(`⚠ No finger segments found to parent to Palm_1`);
            }

            // Log warnings for missing objects
            if (!shoulder) console.warn('⚠ Shoulder_1 not found');
            if (!bicepsUp) console.warn('⚠ Biceps_up_1 not found');
            if (!bicepsLow) console.warn('⚠ Biceps_low_1 not found');
            if (!forearm) console.warn('⚠ Forearm_1 not found');
            if (!palm) console.warn('⚠ Palm_1 not found');

            // CRITICAL: Ensure all arm objects that weren't reparented still have parents
            // This prevents any parts from being orphaned
            const reparentedObjects = new Set([shoulder, bicepsUp, bicepsLow, forearm, palm, ...fingerObjects].filter(obj => obj !== null));
            armObjects.forEach(obj => {
                if (!reparentedObjects.has(obj) && !obj.parent) {
                    // Object was removed from parent but not reparented - add back to scene
                    console.warn(`⚠ Arm object "${obj.name || 'unnamed'}" has no parent - adding to scene root`);
                    glbScene.add(obj);
                }
            });

            // Add root back to scene if needed (only if it's not already in the scene)
            if (shoulder && !shoulder.parent && !glbScene.children.includes(shoulder)) {
                glbScene.add(shoulder);
                console.log('✓ Shoulder_1 added to scene root');
            }

            // Restore world positions by calculating local transforms relative to new parents
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

            // Restore transforms for all objects we reparented (process from root to leaves)
            // Must restore in hierarchy order: parent before child
            // Use the world matrices we stored BEFORE reparenting to preserve original positions
            const restoreOrder = [shoulder, bicepsUp, bicepsLow, forearm, palm, ...fingerObjects].filter(obj => obj !== null);
            restoreOrder.forEach(obj => {
                if (obj && worldMatrices.has(obj)) {
                    restoreWorldTransform(obj, worldMatrices.get(obj));
                    obj.updateMatrixWorld(true);
                }
            });

            // CRITICAL: Ensure ALL meshes remain visible and in the scene
            // This prevents any parts from being accidentally hidden or lost
            let totalMeshes = 0;
            let visibleMeshes = 0;
            glbScene.traverse((object) => {
                if (object.isMesh) {
                    totalMeshes++;
                    object.visible = true;
                    object.matrixAutoUpdate = true;
                    if (object.visible) visibleMeshes++;

                    // Ensure mesh has a parent (is in the scene graph)
                    if (!object.parent) {
                        console.warn(`⚠ Mesh "${object.name || 'unnamed'}" has no parent - adding to scene root`);
                        glbScene.add(object);
                    }
                }
            });
            console.log(`✓ Visibility check: ${visibleMeshes}/${totalMeshes} meshes visible`);

            // Final update to ensure all matrices are synchronized
            glbScene.updateMatrixWorld(true);

            console.log('=== HIERARCHY CORRECTION COMPLETE ===');
        }

        function loadGLTFModel(filePath) {
            const loader = new GLTFLoader();
            loader.setMeshoptDecoder(MeshoptDecoder);
            loader.load(
                filePath,
                function (gltf) {
                    console.log('Model loaded successfully!');
                    console.log('GLTF scene:', gltf.scene);
                    model = gltf.scene;

                    // STEP 1: Analyze existing GLB hierarchy (optional - for debugging)
                    // const hierarchyAnalysis = analyzeArmHierarchy(model);
                    // console.log('GLB Hierarchy Analysis:', hierarchyAnalysis);

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
                            console.log('Hidden object:', name, '(type:', child.type + ')');

                            // Also hide all children of this object
                            child.traverse(function (descendant) {
                                if (descendant !== child) {
                                    descendant.visible = false;
                                }
                            });
                            return;
                        }
                    });

                    console.log(`Hidden ${hiddenCount} non-arm objects`);

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
                    console.log('Total meshes found:', meshCount);

                    const box = new THREE.Box3().setFromObject(model);
                    const size = box.getSize(new THREE.Vector3());
                    console.log('Model size:', size);

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
                    console.log('Model added to scene');

                    // STEP 2-5: Correct hierarchy based on GLB analysis
                    // DISABLED - using original hierarchy setup instead
                    // correctHierarchyFromGLB(model);

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

                    console.log('Total objects found:', allObjects.length);
                    console.log('Meshes found (excluding base):', allMeshes.length);
                    console.log('Mesh names:', allMeshes.map(m => m.name || 'unnamed'));

                    // Log ALL objects (not just meshes) to see the complete structure
                    console.log('=== ALL OBJECTS IN MODEL ===');
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
                        console.log(`${index}: ${typeInfo} "${obj.name}" (parent: "${obj.parent}")`);
                    });
                    console.log('=== END OBJECT LIST ===');

                    // Log ALL meshes in order with their details
                    console.log('=== ALL MESHES IN ORDER ===');
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
                    console.log(`Total meshes found: ${allMeshesOrdered.length}`);
                    allMeshesOrdered.forEach((mesh, index) => {
                        console.log(`  [${index}] "${mesh.name}" (parent: "${mesh.parent}", visible: ${mesh.visible})`);
                    });

                    // Extract and categorize mesh names for easier identification
                    console.log('=== MESH NAME ANALYSIS ===');
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

                    console.log('Shoulder meshes:', meshCategories.shoulder.length > 0 ? meshCategories.shoulder : 'NONE FOUND');
                    console.log('Biceps meshes:', meshCategories.biceps.length > 0 ? meshCategories.biceps : 'NONE FOUND');
                    console.log('Forearm meshes:', meshCategories.forearm.length > 0 ? meshCategories.forearm : 'NONE FOUND');
                    console.log('Palm meshes:', meshCategories.palm.length > 0 ? meshCategories.palm : 'NONE FOUND');
                    console.log('Index finger meshes:', meshCategories.fingers.index.length > 0 ? meshCategories.fingers.index : 'NONE FOUND');
                    console.log('Middle finger meshes:', meshCategories.fingers.middle.length > 0 ? meshCategories.fingers.middle : 'NONE FOUND');
                    console.log('Pinky finger meshes:', meshCategories.fingers.pinky.length > 0 ? meshCategories.fingers.pinky : 'NONE FOUND');
                    console.log('Ring finger meshes:', meshCategories.fingers.ring.length > 0 ? meshCategories.fingers.ring : 'NONE FOUND');
                    console.log('Thumb finger meshes:', meshCategories.fingers.thumb.length > 0 ? meshCategories.fingers.thumb : 'NONE FOUND');
                    console.log('Other meshes:', meshCategories.other.length > 0 ? meshCategories.other : 'NONE');
                    console.log('=== END MESH LIST ===');

                    // Find joints - try to find parent groups that contain multiple meshes
                    // Motor3 (Biceps) should be a parent that contains Motor2 (Elbow) and everything below

                    // First, find all parent groups and their children
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

                    console.log('Parent groups found:', parentGroups.length);
                    parentGroups.forEach((pg, idx) => {
                        console.log(`  Group ${idx}: ${pg.name} (${pg.meshes.length} meshes)`);
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
                            console.log(`  findMeshByName('${partialName}'): Found ${typeStr} "${found.name}"`);
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
                                console.log(`    Similar meshes found:`, similarMeshes);
                            }
                        }

                        return found;
                    }

                    // Find all required arm objects
                    console.log('=== SEARCHING FOR ARM MESHES ===');

                    // CRITICAL: Enhanced search for Shoulder_1 (actual name in GLB: Krahu_1_1)
                    let Shoulder_1 = findMeshByName('Krahu_1_1');  // Primary name (actual mesh name)
                    if (!Shoulder_1) {
                        // Try alternative names
                        console.log('Krahu_1_1 not found, trying alternative names for Shoulder_1...');
                        Shoulder_1 = findMeshByName('Krahu') ||
                            findMeshByName('Shoulder_1') ||
                            findMeshByName('Shoulder') ||
                            findMeshByName('shoulder_1') ||
                            findMeshByName('shoulder') ||
                            findMeshByName('Shoulder_Blade') ||
                            findMeshByName('shoulder_blade');
                        if (Shoulder_1) {
                            console.log(`  ✓ Found Shoulder_1 with alternative name: "${Shoulder_1.name}"`);
                        }
                    } else {
                        console.log(`  ✓ Found Shoulder_1 as Krahu_1_1: "${Shoulder_1.name}"`);
                    }

                    // If still not found, search for any mesh with "shoulder" or "krahu" in the name
                    if (!Shoulder_1) {
                        console.log('Searching entire model for any shoulder/krahu mesh...');
                        model.traverse((child) => {
                            if (!Shoulder_1 && child.isMesh && child.name) {
                                const nameLower = child.name.toLowerCase();
                                if (nameLower.includes('shoulder') || nameLower.includes('shldr') || nameLower.includes('krahu')) {
                                    Shoulder_1 = child;
                                    console.log(`  ✓ Found shoulder mesh: "${child.name}"`);
                                }
                            }
                        });
                    }

                    console.log('Shoulder_1 (Krahu_1_1):', Shoulder_1 ? `✓✓✓ FOUND (${Shoulder_1.name})` : '✗✗✗ NOT FOUND');

                    // Search for Mbajtesi_1 (Shoulder parent/base)
                    let Mbajtesi_1 = findMeshByName('Mbajtesi_1');
                    if (!Mbajtesi_1) {
                        console.log('Mbajtesi_1 not found, trying alternative names...');
                        Mbajtesi_1 = findMeshByName('Mbajtesi') ||
                            findMeshByName('mbajtesi_1') ||
                            findMeshByName('mbajtesi');
                        if (Mbajtesi_1) {
                            console.log(`  ✓ Found Mbajtesi_1 with alternative name: "${Mbajtesi_1.name}"`);
                        }
                    } else {
                        console.log(`  ✓ Found Mbajtesi_1: "${Mbajtesi_1.name}"`);
                    }
                    console.log('Mbajtesi_1:', Mbajtesi_1 ? `✓✓✓ FOUND (${Mbajtesi_1.name})` : '✗✗✗ NOT FOUND');

                    const Biceps_up_1 = findMeshByName('Biceps_up_1');
                    console.log('Biceps_up_1:', Biceps_up_1 ? `FOUND (${Biceps_up_1.name})` : 'NOT FOUND');

                    const Biceps_low_1 = findMeshByName('Biceps_low_1');
                    console.log('Biceps_low_1:', Biceps_low_1 ? `FOUND (${Biceps_low_1.name})` : 'NOT FOUND');

                    const Forearm_1 = findMeshByName('Forearm_1');
                    console.log('Forearm_1:', Forearm_1 ? `FOUND (${Forearm_1.name})` : 'NOT FOUND');

                    const Palm_1 = findMeshByName('Palm_1');
                    console.log('Palm_1:', Palm_1 ? `FOUND (${Palm_1.name})` : 'NOT FOUND');

                    console.log('=== SEARCHING FOR FINGER MESHES ===');
                    // Search for all finger segments (1, 2, 3 for each finger)
                    // Segment 1 = closest to palm, Segment 3 = fingertip
                    // NOTE: Actual GLB names have variations: _1_1 vs _1 suffixes, and "Midle" vs "Middle"

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

                    console.log(`Finger search complete: ${foundFingers.length}/15 found (all 3 segments per finger)`);
                    if (foundFingers.length > 0) {
                        console.log('  Found finger parent groups:');
                        foundFingers.forEach(([searchName, obj]) => {
                            console.log(`    ✓ ${searchName} -> found as "${obj.name}"`);
                        });
                    }
                    if (missingFingers.length > 0) {
                        console.log('  Missing finger parent groups:');
                        missingFingers.forEach(([searchName, obj]) => {
                            console.log(`    ✗ ${searchName} - NOT FOUND`);
                        });
                    }
                    // ADDITIONAL: Search for finger parent groups that contain the actual meshes
                    console.log('=== VERIFYING FINGER PARENT GROUPS ===');
                    const allFoundFingers = [Index3_1, Index2_1, Index1_1,
                        Middle3_1, Middle2_1, Middle1_1,
                        Pinky3_1, Pinky2_1, Pinky1_1,
                        Ring3_1, Ring2_1, Ring1_1,
                        Thumb3_1, Thumb2_1, Thumb1_1].filter(f => f !== null);

                    console.log(`Total finger parent groups found: ${allFoundFingers.length}/15`);
                    allFoundFingers.forEach(finger => {
                        console.log(`  - ${finger.name} (type: ${finger.type}, has ${finger.children.length} children)`);
                    });
                    console.log('=== END ARM MESH SEARCH ===');

                    // Log found objects
                    const armObjects = [Mbajtesi_1, Shoulder_1, Biceps_up_1, Biceps_low_1, Forearm_1, Palm_1,
                        Index3_1, Index2_1, Index1_1,
                        Middle3_1, Middle2_1, Middle1_1,
                        Pinky3_1, Pinky2_1, Pinky1_1,
                        Ring3_1, Ring2_1, Ring1_1,
                        Thumb3_1, Thumb2_1, Thumb1_1];
                    const foundObjects = armObjects.filter(obj => obj !== null);
                    console.log('=== ARM OBJECTS IDENTIFIED ===');
                    console.log(`Found ${foundObjects.length} out of ${armObjects.length} required objects`);
                    const names = ['Mbajtesi_1', 'Shoulder_1', 'Biceps_up_1', 'Biceps_low_1', 'Forearm_1', 'Palm_1',
                        'Index3_1', 'Index2_1', 'Index1_1',
                        'Middle3_1', 'Middle2_1', 'Middle1_1',
                        'Pinky3_1', 'Pinky2_1', 'Pinky1_1',
                        'Ring3_1', 'Ring2_1', 'Ring1_1',
                        'Thumb3_1', 'Thumb2_1', 'Thumb1_1'];
                    armObjects.forEach((obj, idx) => {
                        console.log(`${names[idx]}: ${obj ? '✓ FOUND' : '✗ MISSING'}`);
                    });

                    // STEP 2: Preserve current world positions and rotations
                    // Store world matrix of each object to maintain exact placement
                    model.updateMatrixWorld(true);
                    const worldMatrices = new Map();

                    armObjects.forEach(obj => {
                        if (obj) {
                            obj.updateMatrixWorld();
                            worldMatrices.set(obj, obj.matrixWorld.clone());
                            console.log(`Stored world matrix for ${obj.name}`);
                        }
                    });

                    // STEP 3 & 4: Establish hierarchical chain using ThreeJS parenting system
                    console.log('=== REMOVING FROM CURRENT PARENTS ===');

                    // Remove Mbajtesi_1 from its parent first (new root of hierarchy)
                    if (Mbajtesi_1) {
                        const originalParent = Mbajtesi_1.parent;
                        if (originalParent) {
                            console.log(`Removing ${Mbajtesi_1.name} from parent: ${originalParent.name || 'unnamed'}`);
                            originalParent.remove(Mbajtesi_1);
                            console.log(`✓ ${Mbajtesi_1.name} removed from original parent`);
                        } else {
                            console.log(`${Mbajtesi_1.name} has no parent (already orphaned)`);
                        }
                    } else {
                        console.warn('⚠ Mbajtesi_1 NOT FOUND - will use Shoulder_1 as root');
                    }

                    // CRITICAL: Remove Shoulder_1 (Krahu_1_1) from its parent
                    if (Shoulder_1) {
                        const originalParent = Shoulder_1.parent;
                        if (originalParent) {
                            console.log(`Removing ${Shoulder_1.name} from parent: ${originalParent.name || 'unnamed'}`);
                            originalParent.remove(Shoulder_1);
                            console.log(`✓ ${Shoulder_1.name} removed from original parent`);
                        } else {
                            console.log(`${Shoulder_1.name} has no parent (already orphaned)`);
                        }
                    } else {
                        console.warn('⚠ Shoulder_1 (Krahu_1_1) NOT FOUND - cannot attach to hierarchy');
                    }

                    if (Biceps_up_1 && Biceps_up_1.parent) {
                        console.log(`Removing Biceps_up_1 from parent: ${Biceps_up_1.parent.name || 'unnamed'}`);
                        Biceps_up_1.parent.remove(Biceps_up_1);
                    }
                    if (Biceps_low_1 && Biceps_low_1.parent) {
                        Biceps_low_1.parent.remove(Biceps_low_1);
                    }
                    if (Forearm_1 && Forearm_1.parent) {
                        Forearm_1.parent.remove(Forearm_1);
                    }
                    if (Palm_1 && Palm_1.parent) {
                        Palm_1.parent.remove(Palm_1);
                    }
                    // Remove ALL finger parent groups from their current parents
                    const allFingerSegments = [
                        Index3_1, Index2_1, Index1_1,
                        Middle3_1, Middle2_1, Middle1_1,
                        Pinky3_1, Pinky2_1, Pinky1_1,
                        Ring3_1, Ring2_1, Ring1_1,
                        Thumb3_1, Thumb2_1, Thumb1_1
                    ];

                    console.log('=== REMOVING FINGER PARENT GROUPS FROM CURRENT PARENTS ===');
                    allFingerSegments.forEach(finger => {
                        if (finger && finger.parent) {
                            console.log(`  Removing ${finger.name} from parent: ${finger.parent.name || 'unnamed'}`);
                            finger.parent.remove(finger);
                        } else if (finger) {
                            console.log(`  ${finger.name} has no parent (already orphaned)`);
                        }
                    });

                    // Build hierarchy chain (parent -> child relationships)
                    // HIERARCHICAL PARENTING SYSTEM:
                    // Biceps_low_1 -> Forearm_1 -> Palm_1 & [ALL finger segments]
                    // Biceps_up_1 -> Biceps_low_1
                    // Shoulder_1 -> Biceps_up_1 (if Shoulder_1 exists)

                    // Forearm_1 -> Palm_1
                    if (Forearm_1 && Palm_1) {
                        Forearm_1.add(Palm_1);
                        console.log('✓ Forearm_1.add(Palm_1)');
                    }

                    // Forearm_1 -> ALL finger parent groups (so Elbow moves all fingers including base segments)
                    console.log('=== ATTACHING FINGERS TO FOREARM_1 ===');
                    if (Forearm_1) {
                        const fingerSegments = allFingerSegments.filter(f => f !== null);
                        if (fingerSegments.length > 0) {
                            console.log(`Attaching ${fingerSegments.length}/15 finger parent groups to Forearm_1:`);
                            fingerSegments.forEach(finger => {
                                console.log(`  - ${finger.name}`);
                            });
                            Forearm_1.add(...fingerSegments);
                            console.log(`✓✓✓ Forearm_1.add(${fingerSegments.length} finger parent groups) - SUCCESS`);
                            console.log(`✓ All finger meshes will now move with elbow, biceps, shoulder, and shoulder blade`);
                        } else {
                            console.warn('⚠ No finger parent groups found to attach');
                        }
                    } else {
                        console.error('✗ Forearm_1 NOT FOUND - cannot attach fingers!');
                    }

                    // Biceps_low_1 -> Forearm_1
                    if (Biceps_low_1 && Forearm_1) {
                        Biceps_low_1.add(Forearm_1);
                        console.log('✓ Biceps_low_1.add(Forearm_1)');
                    }

                    // Biceps_up_1 -> Biceps_low_1
                    if (Biceps_up_1 && Biceps_low_1) {
                        Biceps_up_1.add(Biceps_low_1);
                        console.log('✓ Biceps_up_1.add(Biceps_low_1)');
                    }

                    // CRITICAL: Build hierarchy - Mbajtesi_1 -> Shoulder_1 -> Biceps_up_1
                    console.log('=== BUILDING MBAJTESI_1 -> SHOULDER_1 (KRAHU_1_1) HIERARCHY ===');

                    // Mbajtesi_1 -> Shoulder_1 (Mbajtesi is the new root)
                    if (Mbajtesi_1 && Shoulder_1) {
                        console.log(`Attaching Shoulder_1 to Mbajtesi_1 (${Mbajtesi_1.name})...`);
                        Mbajtesi_1.add(Shoulder_1);
                        console.log(`✓✓✓ ${Mbajtesi_1.name}.add(${Shoulder_1.name}) - SUCCESS`);
                        console.log(`  ${Mbajtesi_1.name}.children.length: ${Mbajtesi_1.children.length}`);
                        console.log(`  ${Shoulder_1.name}.parent: ${Shoulder_1.parent ? Shoulder_1.parent.name : 'none'}`);
                    } else if (!Mbajtesi_1 && Shoulder_1) {
                        console.log('⚠ Mbajtesi_1 not found - Shoulder_1 will be root');
                    } else if (Mbajtesi_1 && !Shoulder_1) {
                        console.warn('⚠ Shoulder_1 not found - cannot attach to Mbajtesi_1');
                    }

                    // Shoulder_1 -> Biceps_up_1 (attach Biceps to Shoulder)
                    if (Shoulder_1 && Biceps_up_1) {
                        console.log(`Attaching Biceps_up_1 to Shoulder_1 (${Shoulder_1.name})...`);
                        Shoulder_1.add(Biceps_up_1);
                        console.log(`✓✓✓ ${Shoulder_1.name}.add(Biceps_up_1) - SUCCESS`);
                        console.log(`  ${Shoulder_1.name}.children.length: ${Shoulder_1.children.length}`);
                        console.log(`  Biceps_up_1.parent: ${Biceps_up_1.parent ? Biceps_up_1.parent.name : 'none'}`);
                    } else {
                        if (!Shoulder_1) {
                            console.error('✗ CRITICAL: Shoulder_1 (Krahu_1_1) NOT FOUND - cannot build complete hierarchy');
                        }
                        if (!Biceps_up_1) {
                            console.error('✗ CRITICAL: Biceps_up_1 NOT FOUND - cannot build complete hierarchy');
                        }
                    }

                    // Restore world positions by adding root back to scene/model
                    // Use Mbajtesi_1 as root if available, otherwise use Shoulder_1, otherwise Biceps_up_1
                    console.log('=== ADDING ARM ROOT TO SCENE ===');

                    // Determine the root of the hierarchy
                    let armRoot = Mbajtesi_1 || Shoulder_1;

                    if (Mbajtesi_1) {
                        // Mbajtesi_1 exists - make it the root of arm hierarchy
                        console.log(`${Mbajtesi_1.name} found - adding to model as ROOT...`);

                        // Ensure Mbajtesi_1 has no parent before adding to model
                        if (Mbajtesi_1.parent && Mbajtesi_1.parent !== model && Mbajtesi_1.parent !== scene) {
                            console.log(`Removing ${Mbajtesi_1.name} from unexpected parent: ${Mbajtesi_1.parent.name || 'unnamed'}`);
                            Mbajtesi_1.parent.remove(Mbajtesi_1);
                        }

                        // Add Mbajtesi_1 to model if not already in scene hierarchy
                        if (!Mbajtesi_1.parent) {
                            model.add(Mbajtesi_1);
                            console.log(`✓✓✓ ${Mbajtesi_1.name} SUCCESSFULLY added to model (ROOT of arm hierarchy)`);
                            console.log(`  ${Mbajtesi_1.name}.parent: ${Mbajtesi_1.parent ? Mbajtesi_1.parent.name || Mbajtesi_1.parent.type : 'none'}`);
                            console.log(`  ${Mbajtesi_1.name}.visible: ${Mbajtesi_1.visible}`);
                        } else {
                            console.log(`✓ ${Mbajtesi_1.name} already has parent:`, Mbajtesi_1.parent.name || Mbajtesi_1.parent.type);
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
                        console.log(`  ${Mbajtesi_1.name} in scene graph: ${isInScene ? '✓ YES' : '✗ NO'}`);
                        if (isInScene) {
                            console.log(`  Path to scene: ${path.reverse().join(' -> ')}`);
                        }
                    } else if (Shoulder_1) {
                        // Mbajtesi_1 not found, use Shoulder_1 as root
                        console.log(`${Shoulder_1.name} found - adding to model as ROOT (Mbajtesi_1 not found)...`);

                        // Ensure Shoulder_1 has no parent before adding to model
                        if (Shoulder_1.parent && Shoulder_1.parent !== model && Shoulder_1.parent !== scene) {
                            console.log(`Removing ${Shoulder_1.name} from unexpected parent: ${Shoulder_1.parent.name || 'unnamed'}`);
                            Shoulder_1.parent.remove(Shoulder_1);
                        }

                        // Add Shoulder_1 to model if not already in scene hierarchy
                        if (!Shoulder_1.parent) {
                            model.add(Shoulder_1);
                            console.log(`✓✓✓ ${Shoulder_1.name} SUCCESSFULLY added to model (ROOT of arm hierarchy)`);
                            console.log(`  ${Shoulder_1.name}.parent: ${Shoulder_1.parent ? Shoulder_1.parent.name || Shoulder_1.parent.type : 'none'}`);
                            console.log(`  ${Shoulder_1.name}.visible: ${Shoulder_1.visible}`);
                        } else {
                            console.log(`✓ ${Shoulder_1.name} already has parent:`, Shoulder_1.parent.name || Shoulder_1.parent.type);
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
                        console.log(`  ${Shoulder_1.name} in scene graph: ${isInScene ? '✓ YES' : '✗ NO'}`);
                        if (isInScene) {
                            console.log(`  Path: ${path.reverse().join(' -> ')}`);
                        }

                    } else if (Biceps_up_1) {
                        // Shoulder_1 (Krahu_1_1) not found - use Biceps_up_1 as root
                        console.warn('⚠ Shoulder_1 (Krahu_1_1) NOT FOUND - using Biceps_up_1 as ROOT');
                        if (!Biceps_up_1.parent) {
                            model.add(Biceps_up_1);
                            console.log('⚠ Biceps_up_1 added to model as ROOT');
                            console.log('⚠ Shoulder Blade slider will not function without Shoulder_1 (Krahu_1_1)');
                        }
                    } else if (Biceps_low_1) {
                        console.warn('⚠⚠ Only Biceps_low_1 found (Shoulder_1/Krahu_1_1 missing)');
                        if (!Biceps_low_1.parent) {
                            model.add(Biceps_low_1);
                            console.log('⚠⚠ Biceps_low_1 added to model as ROOT');
                        }
                    } else if (Forearm_1) {
                        console.warn('⚠⚠⚠ Only Forearm_1 found (Shoulder_1/Krahu_1_1 missing)');
                        if (!Forearm_1.parent) {
                            model.add(Forearm_1);
                            console.log('⚠⚠⚠ Forearm_1 added to model as ROOT');
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
                        console.log('✓ Restored Mbajtesi_1 world transform');
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

                    // CRITICAL: Final verification for Mbajtesi_1 and Shoulder_1
                    console.log('=== MBAJTESI_1 FINAL VERIFICATION ===');
                    if (Mbajtesi_1) {
                        console.log('Mbajtesi_1 status:');
                        console.log(`  Name: ${Mbajtesi_1.name}`);
                        console.log(`  Type: ${Mbajtesi_1.type}`);
                        console.log(`  Is Mesh: ${Mbajtesi_1.isMesh}`);
                        console.log(`  Visible: ${Mbajtesi_1.visible}`);
                        console.log(`  Parent: ${Mbajtesi_1.parent ? (Mbajtesi_1.parent.name || Mbajtesi_1.parent.type) : 'NONE'}`);
                        console.log(`  Children count: ${Mbajtesi_1.children.length}`);
                        console.log(`  Children names: [${Mbajtesi_1.children.map(c => c.name || 'unnamed').join(', ')}]`);
                        console.log(`  Rotation (x,y,z): (${Mbajtesi_1.rotation.x.toFixed(3)}, ${Mbajtesi_1.rotation.y.toFixed(3)}, ${Mbajtesi_1.rotation.z.toFixed(3)})`);

                        // Ensure Mbajtesi_1 is visible
                        if (!Mbajtesi_1.visible) {
                            Mbajtesi_1.visible = true;
                            console.log('  ✓ Forced Mbajtesi_1 to visible');
                        }
                    } else {
                        console.log('⚠ Mbajtesi_1 not found in model');
                    }

                    console.log('=== SHOULDER_1 (KRAHU_1_1) FINAL VERIFICATION ===');
                    if (Shoulder_1) {
                        console.log('Shoulder_1 (Krahu_1_1) status:');
                        console.log(`  Name: ${Shoulder_1.name}`);
                        console.log(`  Type: ${Shoulder_1.type}`);
                        console.log(`  Is Mesh: ${Shoulder_1.isMesh}`);
                        console.log(`  Visible: ${Shoulder_1.visible}`);
                        console.log(`  Parent: ${Shoulder_1.parent ? (Shoulder_1.parent.name || Shoulder_1.parent.type) : 'NONE'}`);
                        console.log(`  Children count: ${Shoulder_1.children.length}`);
                        console.log(`  Children names: [${Shoulder_1.children.map(c => c.name || 'unnamed').join(', ')}]`);
                        console.log(`  Rotation (x,y,z): (${Shoulder_1.rotation.x.toFixed(3)}, ${Shoulder_1.rotation.y.toFixed(3)}, ${Shoulder_1.rotation.z.toFixed(3)})`);

                        // Ensure Shoulder_1 is visible
                        if (!Shoulder_1.visible) {
                            Shoulder_1.visible = true;
                            console.log('  ✓ Forced Shoulder_1 to visible');
                        }

                        // Verify Shoulder_1 has Biceps_up_1 as child
                        if (Biceps_up_1 && Shoulder_1.children.includes(Biceps_up_1)) {
                            console.log('  ✓✓✓ Biceps_up_1 IS child of Shoulder_1 - hierarchy correct!');
                        } else if (Biceps_up_1) {
                            console.error('  ✗✗✗ Biceps_up_1 is NOT child of Shoulder_1 - hierarchy BROKEN!');
                            console.log('  Attempting to fix...');
                            if (Biceps_up_1.parent) Biceps_up_1.parent.remove(Biceps_up_1);
                            Shoulder_1.add(Biceps_up_1);
                            model.updateMatrixWorld(true);
                            console.log('  ✓ Fixed: Biceps_up_1 now child of Shoulder_1');
                        }

                        // Check if Shoulder_1 is reachable from scene
                        let depth = 0;
                        let current = Shoulder_1;
                        let path = [Shoulder_1.name || 'Shoulder_1'];
                        while (current.parent && depth < 10) {
                            current = current.parent;
                            path.push(current.name || current.type);
                            depth++;
                            if (current === scene) {
                                console.log(`  ✓ Shoulder_1 is in scene graph (depth: ${depth})`);
                                console.log(`  Path: ${path.reverse().join(' -> ')}`);
                                break;
                            }
                        }
                        if (current !== scene) {
                            console.error('  ✗ Shoulder_1 is NOT in scene graph!');
                            console.log('  Current path:', path.reverse().join(' -> '));
                        }
                    } else {
                        console.error('✗✗✗ Shoulder_1 is NULL - was never found in the model!');
                        console.log('Searching entire model for any shoulder-like objects...');
                        const possibleShoulders = [];
                        model.traverse((child) => {
                            if (child.name && child.name.toLowerCase().includes('shoulder')) {
                                possibleShoulders.push({
                                    name: child.name,
                                    type: child.type,
                                    isMesh: child.isMesh
                                });
                            }
                        });
                        console.log('Possible shoulder objects found:', possibleShoulders);
                    }
                    console.log('=== END SHOULDER_1 VERIFICATION ===');

                    // VERIFICATION: Check finger attachments
                    console.log('=== FINGER ATTACHMENT VERIFICATION ===');
                    if (Forearm_1) {
                        const attachedFingers = allFingerSegments.filter(f => f !== null && f.parent === Forearm_1);
                        const detachedFingers = allFingerSegments.filter(f => f !== null && f.parent !== Forearm_1);

                        console.log(`Fingers attached to Forearm_1: ${attachedFingers.length}/${allFingerSegments.filter(f => f !== null).length}`);

                        if (attachedFingers.length > 0) {
                            console.log('  ✓ Attached finger parent groups:');
                            attachedFingers.forEach(f => console.log(`    - ${f.name} (children: ${f.children.length})`));
                        }

                        if (detachedFingers.length > 0) {
                            console.error('  ✗ DETACHED finger parent groups (NOT moving with arm):');
                            detachedFingers.forEach(f => {
                                console.error(`    - ${f.name} (parent: ${f.parent ? f.parent.name : 'none'})`);
                                // Try to re-attach
                                if (f.parent) f.parent.remove(f);
                                Forearm_1.add(f);
                                console.log(`    ✓ Re-attached ${f.name} to Forearm_1`);
                            });
                        }

                        console.log(`Total finger parent groups in hierarchy: ${attachedFingers.length + detachedFingers.length}`);
                    } else {
                        console.error('✗ Forearm_1 not found - cannot verify finger attachments');
                    }
                    console.log('=== END FINGER VERIFICATION ===');

                    // VERIFICATION: Check complete hierarchy
                    console.log('=== HIERARCHY VERIFICATION ===');
                    function printHierarchy(obj, indent = 0) {
                        const prefix = '  '.repeat(indent);
                        const name = obj.name || 'unnamed';
                        const type = obj.isMesh ? '[MESH]' : obj.isBone ? '[BONE]' : `[${obj.type}]`;
                        console.log(`${prefix}${type} ${name}`);
                        obj.children.forEach(child => {
                            // Only print arm-related children
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

                    if (Shoulder_1) {
                        console.log('Complete arm hierarchy starting from Shoulder_1:');
                        printHierarchy(Shoulder_1);
                    } else if (Biceps_up_1) {
                        console.log('Complete arm hierarchy starting from Biceps_up_1:');
                        printHierarchy(Biceps_up_1);
                    } else if (Biceps_low_1) {
                        console.log('Complete arm hierarchy starting from Biceps_low_1:');
                        printHierarchy(Biceps_low_1);
                    } else if (Forearm_1) {
                        console.log('Complete arm hierarchy starting from Forearm_1:');
                        printHierarchy(Forearm_1);
                    }

                    // Count visible meshes
                    let visibleArmMeshes = 0;
                    model.traverse((child) => {
                        if (child.isMesh && child.visible && child.name && !child.name.includes('base') && !child.name.includes('mesh_0')) {
                            visibleArmMeshes++;
                        }
                    });
                    console.log(`Total visible arm meshes in scene: ${visibleArmMeshes}`);
                    console.log('=== END HIERARCHY VERIFICATION ===');

                    // Assign motors to the actual mesh objects (not groups)
                    // These will be used by the slider rotation functions
                    motors.motor2 = Forearm_1;      // Elbow rotates Forearm_1
                    motors.motor3 = Shoulder_1;     // Shoulder rotates Shoulder_1 (Z-axis - rotates in place)
                    motors.motor4 = Biceps_up_1;    // Shoulder Blade rotates Biceps_up_1 (X-axis - forward/back)
                    motors.motor5 = Biceps_low_1;   // Biceps rotates Biceps_low_1

                    console.log('=== MOTOR ASSIGNMENTS ===');
                    const motorStatus = {
                        motor2: motors.motor2 ? `✓ ${motors.motor2.name}` : '✗ NOT FOUND',
                        motor3: motors.motor3 ? `✓ ${motors.motor3.name}` : '✗ NOT FOUND',
                        motor4: motors.motor4 ? `✓ ${motors.motor4.name}` : '✗ NOT FOUND (Shoulder Blade slider will not work)',
                        motor5: motors.motor5 ? `✓ ${motors.motor5.name}` : '✗ NOT FOUND'
                    };
                    console.log('  motor2 (Elbow - Forearm_1):', motorStatus.motor2);
                    console.log('  motor3 (Shoulder - Shoulder_1):', motorStatus.motor3);
                    console.log('  motor4 (Shoulder Blade - Biceps_up_1):', motorStatus.motor4);
                    console.log('  motor5 (Biceps - Biceps_low_1):', motorStatus.motor5);

                    console.log('=== PARENTING HIERARCHY ESTABLISHED ===');
                    if (Shoulder_1) {
                        console.log('Hierarchy: Shoulder_1 -> Biceps_up_1 -> Biceps_low_1 -> Forearm_1 -> Palm_1 & [fingers]');
                    } else {
                        console.log('Hierarchy: Biceps_up_1 -> Biceps_low_1 -> Forearm_1 -> Palm_1 & [fingers]');
                        console.log('⚠ WARNING: Shoulder_1 missing - hierarchy starts at Biceps_up_1');
                    }

                    // Verify hierarchy
                    if (Shoulder_1) {
                        console.log('Shoulder_1 children:', Shoulder_1.children.map(c => c.name || 'unnamed'));
                    }
                    if (Biceps_up_1) {
                        console.log('Biceps_up_1 children:', Biceps_up_1.children.map(c => c.name || 'unnamed'));
                    }
                    if (Biceps_low_1) {
                        console.log('Biceps_low_1 children:', Biceps_low_1.children.map(c => c.name || 'unnamed'));
                    }
                    if (Forearm_1) {
                        console.log('Forearm_1 children:', Forearm_1.children.map(c => c.name || 'unnamed'));
                    }
                    if (Palm_1) {
                        console.log('Palm_1 children:', Palm_1.children.map(c => c.name || 'unnamed'));
                    }

                    // FINAL CHECK: Ensure base_link and Cube are hidden
                    console.log('=== FINAL VISIBILITY CHECK ===');
                    let baseLinkFound = false;
                    let cubeFound = false;
                    model.traverse(function (child) {
                        const name = child.name || '';
                        if (name === 'base_link' || name.toLowerCase().includes('base_link') || name.toLowerCase().includes('baselink')) {
                            child.visible = false;
                            baseLinkFound = true;
                            console.log('✓ base_link hidden:', name);
                            // Hide all its children too
                            child.traverse(function (desc) {
                                if (desc !== child) desc.visible = false;
                            });
                        }
                        if (name === 'Cube' || name.toLowerCase() === 'cube') {
                            child.visible = false;
                            cubeFound = true;
                            console.log('✓ Cube hidden:', name);
                            // Hide all its children too
                            child.traverse(function (desc) {
                                if (desc !== child) desc.visible = false;
                            });
                        }
                    });
                    if (!baseLinkFound) console.log('⚠ base_link not found in model (might already be removed)');
                    if (!cubeFound) console.log('⚠ Cube not found in model (might already be removed)');
                    console.log('=== END VISIBILITY CHECK ===');

                    // Initialize the biomechanical arm joint system
                    // This sets up the hierarchical joint control for natural arm movement
                    setTimeout(() => {
                        ensureArmSystemInitialized();
                    }, 100); // Small delay to ensure all transforms are finalized
                },
                function (xhr) {
                    if (xhr.lengthComputable) {
                        console.log((xhr.loaded / xhr.total * 100) + '% loaded');
                    }
                },
                function (error) {
                    console.error('Error loading GLTF model:', error);
                    console.error('Make sure the file exists and you are running from a web server (not file://)');
                    console.error('Try: python -m http.server 8000 (then open http://localhost:8000)');
                }
            );
        }

        function loadSTLModel(filePath) {
            const loader = new STLLoader();
            loader.load(
                filePath,
                function (geometry) {
                    console.log('STL Model loaded successfully!');
                    const material = new THREE.MeshPhongMaterial({
                        color: 0x5a9fff,
                        shininess: 100
                    });
                    model = new THREE.Mesh(geometry, material);

                    geometry.center();
                    const box = new THREE.Box3().setFromObject(model);
                    const size = box.getSize(new THREE.Vector3());
                    const maxDim = Math.max(size.x, size.y, size.z);
                    const scale = 5 / maxDim;
                    model.scale.multiplyScalar(scale);

                    scene.add(model);
                    console.log('Model added to scene');

                    motors.motor2 = model;
                    motors.motor3 = model;
                    motors.motor4 = model;
                    motors.motor5 = model;
                },
                function (xhr) {
                    if (xhr.lengthComputable) {
                        console.log((xhr.loaded / xhr.total * 100) + '% loaded');
                    }
                },
                function (error) {
                    console.error('Error loading STL model:', error);
                    console.error('Make sure the file exists and you are running from a web server (not file://)');
                }
            );
        }

        function findMotorByName(object, name) {
            if (object.name && object.name.toLowerCase().includes(name.toLowerCase())) {
                return object;
            }
            if (object.children) {
                for (let i = 0; i < object.children.length; i++) {
                    const found = findMotorByName(object.children[i], name);
                    if (found) return found;
                }
            }
            return null;
        }

        function findMotorByIndex(object, index) {
            const allMeshes = [];
            object.traverse(function (child) {
                if (child.isMesh) {
                    allMeshes.push(child);
                }
            });
            console.log('All meshes found:', allMeshes.length, allMeshes.map(m => m.name || 'unnamed'));
            return allMeshes[index] || null;
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
                    console.log(`Found exact match for ${name}: ${childName}`);
                    return;
                }

                // Try partial match (contains)
                if (nameLower.includes(searchLower) || searchLower.includes(nameLower)) {
                    if (!found) { // Only take first match
                        found = child;
                        console.log(`Found partial match for ${name}: ${childName}`);
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

            console.log('=== INITIALIZING ARM JOINT SYSTEM ===');

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
                    console.log(`✓ ${jointKey} joint (${displayNames[index]}): FOUND - ${joint.name}`);
                } else {
                    console.warn(`✗ ${jointKey} joint (${displayNames[index]}): MISSING`);
                    allFound = false;
                }
            });

            // Verify hierarchy is correct by checking parent-child relationships
            console.log('=== VERIFYING HIERARCHY ===');

            // Check if Mbajtesi_1 exists and verify it's the parent of Shoulder_1
            let mbajtesiFound = false;
            if (model) {
                model.traverse((child) => {
                    if (child.name === 'Mbajtesi_1' || child.name === 'Mbajtesi') {
                        mbajtesiFound = true;
                        if (armJoints.shoulder && child.children.includes(armJoints.shoulder)) {
                            console.log('✓ Mbajtesi_1 -> Shoulder_1 (correct)');
                        } else if (armJoints.shoulder) {
                            console.log(`ℹ Mbajtesi_1 found but Shoulder_1 parent is: ${armJoints.shoulder.parent ? armJoints.shoulder.parent.name : 'none'}`);
                        }
                    }
                });
            }
            if (!mbajtesiFound) {
                console.log('ℹ Mbajtesi_1 not found in model - using Shoulder_1 as root');
            }

            // Check Shoulder_1 -> Biceps_up_1
            if (armJoints.shoulder && armJoints.shoulderBlade) {
                if (armJoints.shoulderBlade.parent === armJoints.shoulder) {
                    console.log('✓ Shoulder_1 -> Biceps_up_1 (correct)');
                } else {
                    console.warn('✗ Shoulder_1 -> Biceps_up_1 (incorrect, fixing...)');
                    // Try to fix the hierarchy
                    if (armJoints.shoulderBlade.parent) {
                        armJoints.shoulderBlade.parent.remove(armJoints.shoulderBlade);
                    }
                    armJoints.shoulder.add(armJoints.shoulderBlade);
                    console.log('✓ Fixed: Shoulder_1 -> Biceps_up_1');
                }
            } else {
                if (!armJoints.shoulder) {
                    console.warn('⚠ Shoulder_1 not found - Biceps_up_1 will be root of hierarchy');
                }
            }

            // Check Biceps_up_1 -> Biceps_low_1
            if (armJoints.shoulderBlade && armJoints.biceps) {
                if (armJoints.biceps.parent === armJoints.shoulderBlade) {
                    console.log('✓ Biceps_up_1 -> Biceps_low_1 (correct)');
                } else {
                    console.warn('✗ Biceps_up_1 -> Biceps_low_1 (incorrect, fixing...)');
                    if (armJoints.biceps.parent) {
                        armJoints.biceps.parent.remove(armJoints.biceps);
                    }
                    armJoints.shoulderBlade.add(armJoints.biceps);
                    console.log('✓ Fixed: Biceps_up_1 -> Biceps_low_1');
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
                    console.log('✓ Biceps_low_1 -> Forearm_1 (correct)');
                } else {
                    console.warn('✗ Biceps_low_1 -> Forearm_1 (incorrect, fixing...)');
                    if (armJoints.elbow.parent) {
                        armJoints.elbow.parent.remove(armJoints.elbow);
                    }
                    armJoints.biceps.add(armJoints.elbow);
                    console.log('✓ Fixed: Biceps_low_1 -> Forearm_1');
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

            console.log('=== HIERARCHY VERIFICATION COMPLETE ===');

            console.log(allFound ? '=== ARM JOINT SYSTEM READY ===' : '=== ARM JOINT SYSTEM INCOMPLETE ===');
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

            // Debug: Log rotation change
            if (Math.abs(angle) > 0.01) {
                console.log(`  Shoulder_1 rotation.x: ${shoulderInitial.x.toFixed(3)} → ${shoulderJoint.rotation.x.toFixed(3)} (Δ: ${angle.toFixed(3)} rad)`);
                console.log(`  Arm spinning like a wheel on X-axis`);
            }

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

            console.log(`  Shoulder slider: Biceps_up_1 rotation.y = ${joint.rotation.y.toFixed(3)} (angle: ${angle.toFixed(3)})`);

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
                console.log(`${label}: ${animation.currentValue.toFixed(1)}° (${angleRad.toFixed(3)} rad)`);
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
                console.log('Gradually resetting all sliders to 0°');
                
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

        console.log('Attempting to load model:', modelPath);

        if (fileExtension === 'gltf' || fileExtension === 'glb') {
            loadGLTFModel(modelPath);
        } else if (fileExtension === 'stl') {
            loadSTLModel(modelPath);
        }

        animate();
    }

    initThreeJS();
})();
