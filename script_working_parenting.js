import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/loaders/STLLoader.js';
import { MeshoptDecoder } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/libs/meshopt_decoder.module.js';

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

        console.log('Three.js initialized');
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

            // Parent all finger segments to palm
            const fingerNames = ['Index3_1', 'Index2_1', 'Middle3_1', 'Middle2_1', 'Pinky3_1', 'Ring3_1', 'Thumb3_1', 'Thumb2_1'];
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

                    // Enable shadows, improve materials, and remove base (mesh_0)
                    let meshCount = 0;
                    model.traverse(function (child) {
                        if (child.isMesh) {
                            meshCount++;
                            child.castShadow = true;
                            child.receiveShadow = true;

                            // Remove base mesh (mesh_0) - but keep others visible
                            if (child.name === 'mesh_0' || (child.name && child.name.toLowerCase().includes('base'))) {
                                child.visible = false;
                                console.log('Base mesh hidden:', child.name);
                                return;
                            }

                            // Ensure mesh is visible
                            child.visible = true;

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
                                type: child.type
                            });
                        }
                    });
                    allMeshesOrdered.forEach((mesh, index) => {
                        console.log(`Mesh ${index}: "${mesh.name}" (parent: "${mesh.parent}", type: ${mesh.type})`);
                    });
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
                        
                        model.traverse(function (child) {
                            if (!child.name) return;
                            
                            const childName = child.name;
                            const nameLower = childName.toLowerCase();
                            const searchLower = partialName.toLowerCase();
                            
                            // Check for exact match
                            const isExactMatch = childName === partialName || nameLower === searchLower;
                            
                            // Check for partial match
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
                            }
                        });
                        
                        // Return in order of preference: Mesh > Bone > Group
                        found = meshFound || boneFound || groupFound;
                        
                        if (found) {
                            const typeStr = found.isMesh ? 'Mesh' : (found.isBone ? 'Bone' : found.type);
                            console.log(`  findMeshByName('${partialName}'): Found ${typeStr} "${found.name}"`);
                        } else {
                            console.warn(`  findMeshByName('${partialName}'): NOT FOUND`);
                        }
                        
                        return found;
                    }

                    // Find all required arm objects
                    console.log('=== SEARCHING FOR ARM MESHES ===');
                    const Shoulder_1 = findMeshByName('Shoulder_1');
                    console.log('Shoulder_1:', Shoulder_1 ? `FOUND (${Shoulder_1.name})` : 'NOT FOUND');
                    
                    const Biceps_up_1 = findMeshByName('Biceps_up_1');
                    console.log('Biceps_up_1:', Biceps_up_1 ? `FOUND (${Biceps_up_1.name})` : 'NOT FOUND');
                    
                    const Biceps_low_1 = findMeshByName('Biceps_low_1');
                    console.log('Biceps_low_1:', Biceps_low_1 ? `FOUND (${Biceps_low_1.name})` : 'NOT FOUND');
                    
                    const Forearm_1 = findMeshByName('Forearm_1');
                    console.log('Forearm_1:', Forearm_1 ? `FOUND (${Forearm_1.name})` : 'NOT FOUND');
                    
                    const Palm_1 = findMeshByName('Palm_1');
                    console.log('Palm_1:', Palm_1 ? `FOUND (${Palm_1.name})` : 'NOT FOUND');
                    
                    const Index3_1 = findMeshByName('Index3_1');
                    const Index2_1 = findMeshByName('Index2_1');
                    const Middle3_1 = findMeshByName('Middle3_1');
                    const Middle2_1 = findMeshByName('Middle2_1');
                    const Pinky3_1 = findMeshByName('Pinky3_1');
                    const Ring3_1 = findMeshByName('Ring3_1');
                    const Thumb3_1 = findMeshByName('Thumb3_1');
                    const Thumb2_1 = findMeshByName('Thumb2_1');
                    console.log('=== END ARM MESH SEARCH ===');

                    // Log found objects
                    const armObjects = [Shoulder_1, Biceps_up_1, Biceps_low_1, Forearm_1, Palm_1, 
                                       Index3_1, Index2_1, Middle3_1, Middle2_1, Pinky3_1, Ring3_1, Thumb3_1, Thumb2_1];
                    const foundObjects = armObjects.filter(obj => obj !== null);
                    console.log('=== ARM OBJECTS IDENTIFIED ===');
                    console.log(`Found ${foundObjects.length} out of ${armObjects.length} required objects`);
                    armObjects.forEach((obj, idx) => {
                        const names = ['Shoulder_1', 'Biceps_up_1', 'Biceps_low_1', 'Forearm_1', 'Palm_1', 
                                      'Index3_1', 'Index2_1', 'Middle3_1', 'Middle2_1', 'Pinky3_1', 'Ring3_1', 'Thumb3_1', 'Thumb2_1'];
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
                    // Remove from current parents without changing scene position
                    if (Shoulder_1 && Shoulder_1.parent) {
                        Shoulder_1.parent.remove(Shoulder_1);
                    }
                    if (Biceps_up_1 && Biceps_up_1.parent) {
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
                    // Remove finger segments from their current parents
                    [Index3_1, Index2_1, Middle3_1, Middle2_1, Pinky3_1, Ring3_1, Thumb3_1, Thumb2_1].forEach(finger => {
                        if (finger && finger.parent) {
                            finger.parent.remove(finger);
                        }
                    });

                    // Build hierarchy chain (parent -> child relationships)
                    // Shoulder_1 -> Biceps_up_1
                    if (Shoulder_1 && Biceps_up_1) {
                        Shoulder_1.add(Biceps_up_1);
                        console.log('✓ Shoulder_1.add(Biceps_up_1)');
                    }

                    // Biceps_up_1 -> Biceps_low_1
                    if (Biceps_up_1 && Biceps_low_1) {
                        Biceps_up_1.add(Biceps_low_1);
                        console.log('✓ Biceps_up_1.add(Biceps_low_1)');
                    }

                    // Biceps_low_1 -> Forearm_1
                    if (Biceps_low_1 && Forearm_1) {
                        Biceps_low_1.add(Forearm_1);
                        console.log('✓ Biceps_low_1.add(Forearm_1)');
                    }

                    // Forearm_1 -> Palm_1
                    if (Forearm_1 && Palm_1) {
                        Forearm_1.add(Palm_1);
                        console.log('✓ Forearm_1.add(Palm_1)');
                    }

                    // Palm_1 -> All finger segments
                    if (Palm_1) {
                        const fingerSegments = [Index3_1, Index2_1, Middle3_1, Middle2_1, Pinky3_1, Ring3_1, Thumb3_1, Thumb2_1].filter(f => f !== null);
                        if (fingerSegments.length > 0) {
                            Palm_1.add(...fingerSegments);
                            console.log(`✓ Palm_1.add(${fingerSegments.length} finger segments)`);
                        }
                    }

                    // Restore world positions by adding root back to scene
                    if (Shoulder_1 && !Shoulder_1.parent) {
                        scene.add(Shoulder_1);
                        console.log('✓ Shoulder_1 added to scene');
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
                    [Index3_1, Index2_1, Middle3_1, Middle2_1, Pinky3_1, Ring3_1, Thumb3_1, Thumb2_1].forEach(finger => {
                        if (finger && worldMatrices.has(finger)) {
                            restoreWorldTransform(finger, worldMatrices.get(finger));
                            finger.updateMatrixWorld(true);
                        }
                    });

                    // Final update to ensure all matrices are synchronized
                    model.updateMatrixWorld(true);

                    // Assign motors to the actual mesh objects (not groups)
                    // These will be used by the slider rotation functions
                    motors.motor2 = Forearm_1;      // Elbow rotates Forearm_1
                    motors.motor3 = Biceps_up_1;    // Shoulder rotates Biceps_up_1
                    motors.motor4 = Shoulder_1;     // Shoulder Blade rotates Shoulder_1
                    motors.motor5 = Biceps_low_1;   // Biceps rotates Biceps_low_1

                    console.log('=== PARENTING HIERARCHY ESTABLISHED ===');
                    console.log('Hierarchy: Shoulder_1 -> Biceps_up_1 -> Biceps_low_1 -> Forearm_1 -> Palm_1 -> [fingers]');
                    console.log('Motor assignments:');
                    console.log('  motor2 (Elbow):', motors.motor2 ? motors.motor2.name : 'MISSING');
                    console.log('  motor3 (Shoulder):', motors.motor3 ? motors.motor3.name : 'MISSING');
                    console.log('  motor4 (Shoulder Blade):', motors.motor4 ? motors.motor4.name : 'MISSING');
                    console.log('  motor5 (Biceps):', motors.motor5 ? motors.motor5.name : 'MISSING');

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
            if (motors.motor4) armJoints.shoulderBlade = motors.motor4;
            if (motors.motor3) armJoints.shoulder = motors.motor3;
            if (motors.motor5) armJoints.biceps = motors.motor5;
            if (motors.motor2) armJoints.elbow = motors.motor2;

            // If any are missing, search the model directly
            const meshNames = {
                shoulderBlade: 'Shoulder_1',
                shoulder: 'Biceps_up_1',
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
            const displayNames = ['Shoulder_1', 'Biceps_up_1', 'Biceps_low_1', 'Forearm_1'];
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
            if (allFound) {
                console.log('=== VERIFYING HIERARCHY ===');
                
                if (armJoints.shoulder && armJoints.shoulder.parent === armJoints.shoulderBlade) {
                    console.log('✓ Shoulder_1 -> Biceps_up_1');
                } else if (armJoints.shoulder && armJoints.shoulderBlade) {
                    console.warn('✗ Shoulder hierarchy incorrect - attempting to fix...');
                    // Try to fix the hierarchy
                    if (armJoints.shoulder.parent) {
                        armJoints.shoulder.parent.remove(armJoints.shoulder);
                    }
                    armJoints.shoulderBlade.add(armJoints.shoulder);
                    console.log('✓ Fixed: Shoulder_1 -> Biceps_up_1');
                }

                if (armJoints.biceps && armJoints.biceps.parent === armJoints.shoulder) {
                    console.log('✓ Biceps_up_1 -> Biceps_low_1');
                } else if (armJoints.biceps && armJoints.shoulder) {
                    console.warn('✗ Biceps hierarchy incorrect - attempting to fix...');
                    if (armJoints.biceps.parent) {
                        armJoints.biceps.parent.remove(armJoints.biceps);
                    }
                    armJoints.shoulder.add(armJoints.biceps);
                    console.log('✓ Fixed: Biceps_up_1 -> Biceps_low_1');
                }

                if (armJoints.elbow && armJoints.elbow.parent === armJoints.biceps) {
                    console.log('✓ Biceps_low_1 -> Forearm_1');
                } else if (armJoints.elbow && armJoints.biceps) {
                    console.warn('✗ Elbow hierarchy incorrect - attempting to fix...');
                    if (armJoints.elbow.parent) {
                        armJoints.elbow.parent.remove(armJoints.elbow);
                    }
                    armJoints.biceps.add(armJoints.elbow);
                    console.log('✓ Fixed: Biceps_low_1 -> Forearm_1');
                }

                // Update world matrices after any hierarchy fixes
                model.updateMatrixWorld(true);
            }

            console.log(allFound ? '=== ARM JOINT SYSTEM READY ===' : '=== ARM JOINT SYSTEM INCOMPLETE ===');
            return allFound;
        }

        /**
         * STEP 4-7: Movement functions for each joint
         * Each function rotates ONLY the specified joint mesh.
         * All child joints automatically move through ThreeJS parent-child hierarchy.
         */

        /**
         * STEP 4: Shoulder Blade Movement (Shoulder_1)
         * Moves: Shoulder_1, Biceps_up_1, Biceps_low_1, Forearm_1, Palm_1, and all finger joints
         * @param {number} angle - Rotation angle in radians
         */
        function rotateShoulderBlade(angle) {
            const joint = armJoints.shoulderBlade;
            if (!joint) {
                console.warn('⚠ Shoulder blade joint not available');
                return;
            }

            const initial = initialRotations.get('shoulderBlade');
            if (!initial) return;

            // Rotate around Z axis (vertical rotation of entire arm)
            joint.rotation.z = initial.z + angle;
            
            // Update matrices to propagate transformation to all children
            joint.updateMatrixWorld(true);
        }

        /**
         * STEP 5: Shoulder Movement (Biceps_up_1)
         * Moves: Biceps_up_1, Biceps_low_1, Forearm_1, Palm_1, and all finger joints
         * @param {number} angle - Rotation angle in radians
         */
        function rotateShoulder(angle) {
            const joint = armJoints.shoulder;
            if (!joint) {
                console.warn('⚠ Shoulder joint not available');
                return;
            }

            const initial = initialRotations.get('shoulder');
            if (!initial) return;

            // Rotate around X axis (forward/backward movement of arm)
            joint.rotation.x = initial.x + angle;
            
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
        // SLIDER EVENT HANDLERS - HIERARCHICAL ARM MOVEMENT
        // ============================================
        // Each slider controls one joint. Moving a joint automatically moves all
        // hierarchical children through ThreeJS parent-child relationships.
        //
        // STEP 8: Ensure independent joint control with automatic child propagation

        // Slider 0: ELBOW - Controls Forearm_1 rotation
        // Moves: Forearm_1, Palm_1, and all finger joints
        activeSliders[0].addEventListener('input', function () {
            if (!ensureArmSystemInitialized()) return;

            const value = parseFloat(this.value);
            const normalizedValue = (value - 50) / 50; // Range: -1 to 1
            const angleRad = normalizedValue * Math.PI * 0.5; // Range: -90° to +90°

            rotateElbow(angleRad);
        });

        // Slider 1: BICEPS - Controls Biceps_low_1 rotation
        // Moves: Biceps_low_1, Forearm_1, Palm_1, and all finger joints
        if (activeSliders[1]) {
            activeSliders[1].addEventListener('input', function () {
                if (!ensureArmSystemInitialized()) return;

                const value = parseFloat(this.value);
                const normalizedValue = (value - 50) / 50; // Range: -1 to 1
                const angleRad = normalizedValue * Math.PI * 0.5; // Range: -90° to +90°

                rotateBiceps(angleRad);
            });
        }

        // Slider 2: SHOULDER - Controls Biceps_up_1 rotation
        // Moves: Biceps_up_1, Biceps_low_1, Forearm_1, Palm_1, and all finger joints
        if (activeSliders[2]) {
            activeSliders[2].addEventListener('input', function () {
                if (!ensureArmSystemInitialized()) return;

                const value = parseFloat(this.value);
                const normalizedValue = (value - 50) / 50; // Range: -1 to 1
                const angleRad = normalizedValue * Math.PI * 0.5; // Range: -90° to +90°

                rotateShoulder(angleRad);
            });
        }

        // Slider 3: SHOULDER BLADE - Controls Shoulder_1 rotation
        // Moves: Shoulder_1, Biceps_up_1, Biceps_low_1, Forearm_1, Palm_1, and all finger joints
        if (activeSliders[3]) {
            activeSliders[3].addEventListener('input', function () {
                if (!ensureArmSystemInitialized()) return;

                const value = parseFloat(this.value);
                const normalizedValue = (value - 50) / 50; // Range: -1 to 1
                const angleRad = normalizedValue * Math.PI * 0.5; // Range: -90° to +90°

                rotateShoulderBlade(angleRad);
            });
        }

        function animate() {
            requestAnimationFrame(animate);
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
