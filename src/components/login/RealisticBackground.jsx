import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const RealisticBackground = ({ isExiting }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1128); // Lighter navy blue
    scene.fog = new THREE.Fog(0x0a1128, 30, 150); // Pushed fog further back

    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // 2. Lights (Significantly Brighter)
    const ambientLight = new THREE.AmbientLight(0x808080, 1.2); // Much brighter base
    scene.add(ambientLight);

    const moonLight = new THREE.DirectionalLight(0x4080ff, 1.0); // Stronger cool top light
    moonLight.position.set(20, 40, 20);
    scene.add(moonLight);

    // Work Zone Floodlights (New)
    const floodlight1 = new THREE.PointLight(0xffffff, 20, 60);
    floodlight1.position.set(10, 15, 0);
    scene.add(floodlight1);

    const floodlight2 = new THREE.PointLight(0xffffff, 20, 60);
    floodlight2.position.set(-10, 15, -40);
    scene.add(floodlight2);

    // Truck Spotlights (Emergency Flickering)
    const leftTruckLight = new THREE.PointLight(0xffa500, 3, 40);
    leftTruckLight.position.set(-4, 4, -10);
    scene.add(leftTruckLight);

    const rightTruckLight = new THREE.PointLight(0xffa500, 3, 40);
    rightTruckLight.position.set(-4, 4, -50);
    scene.add(rightTruckLight);

    // 3. Environment: Asphalt Road
    const roadGroup = new THREE.Group();
    scene.add(roadGroup);

    const roadGeo = new THREE.PlaneGeometry(120, 300);
    const roadMat = new THREE.MeshStandardMaterial({ 
      color: 0x222222, 
      roughness: 0.7, 
      metalness: 0.1 
    });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    roadGroup.add(road);

    // Hazard / Excavation Area (New)
    const hazardGeo = new THREE.PlaneGeometry(8, 15);
    const hazardMat = new THREE.MeshStandardMaterial({ 
      color: 0x111111, 
      roughness: 0.9, 
      metalness: 0 
    });
    const hazardArea = new THREE.Mesh(hazardGeo, hazardMat);
    hazardArea.rotation.x = -Math.PI / 2;
    hazardArea.position.set(-4, 0.02, -60); // In the work zone
    roadGroup.add(hazardArea);

    // Welding Sparks Effect (New)
    const sparksGeometry = new THREE.BufferGeometry();
    const sparksCount = 50;
    const sparksPos = new Float32Array(sparksCount * 3);
    for (let i = 0; i < sparksCount * 3; i++) sparksPos[i] = 0;
    sparksGeometry.setAttribute('position', new THREE.BufferAttribute(sparksPos, 3));
    
    const sparksMaterial = new THREE.PointsMaterial({
      color: 0x0ea5e9,
      size: 0.2,
      blending: THREE.AdditiveBlending,
      transparent: true
    });
    const sparks = new THREE.Points(sparksGeometry, sparksMaterial);
    sparks.position.set(-2, 1, -55); // Near the truck
    scene.add(sparks);

    // Lane Markings
    for (let i = 0; i < 10; i++) {
      const markGeo = new THREE.PlaneGeometry(0.5, 10);
      const markMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
      const mark = new THREE.Mesh(markGeo, markMat);
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(0, 0.01, -100 + (i * 25));
      roadGroup.add(mark);
    }

    // 4. Load Models & Add Streaks
    const loader = new GLTFLoader();
    const assets = new THREE.Group();
    scene.add(assets);

    // Load First Aid / Utility Kit (New)
    loader.load('/models/firstaid.glb', (gltf) => {
      const kit = gltf.scene;
      kit.scale.set(0.8, 0.8, 0.8);
      kit.position.set(-8, 0, -45);
      kit.rotation.y = Math.PI / 4;
      assets.add(kit);
    });

    // Active Traffic Streaks (Light Trails)
    const trafficGroup = new THREE.Group();
    scene.add(trafficGroup);
    const streaks = [];
    const createStreak = (x, color) => {
      const geometry = new THREE.BoxGeometry(0.1, 0.05, 10 + Math.random() * 15);
      const material = new THREE.MeshBasicMaterial({ 
        color, 
        transparent: true, 
        opacity: 0.8, 
        blending: THREE.AdditiveBlending 
      });
      const streak = new THREE.Mesh(geometry, material);
      streak.position.set(x, 0.1, -150 - Math.random() * 100);
      const speed = 1.5 + Math.random() * 2.5;
      return { mesh: streak, speed };
    };

    // Add Red Taillights (Left Lanes)
    for (let i = 0; i < 8; i++) {
      const s = createStreak(-15 - Math.random() * 5, 0xff0000);
      trafficGroup.add(s.mesh);
      streaks.push(s);
    }
    // Add White Headlights (Right Lanes)
    for (let i = 0; i < 8; i++) {
      const s = createStreak(15 + Math.random() * 5, 0xffffff);
      s.speed *= -1; // Opposite direction
      s.mesh.position.z = 100 + Math.random() * 100;
      trafficGroup.add(s.mesh);
      streaks.push(s);
    }

    // Load Cones & Arrange as a proper zone
    loader.load('/models/cone.glb', (gltf) => {
      const coneModel = gltf.scene;

      // 1. The Taper - REMOVED

      // 2. The Work Area Perimeter (Rectangular safety zone)
      // Starts after a buffer space
      const workAreaZStart = -40;
      const workAreaWidth = 10;

      for (let i = 0; i < 20; i++) {
        const z = workAreaZStart - (i * 4);
        // Left boundary of closed lane
        const leftCone = coneModel.clone();
        leftCone.position.set(-9, 0, z);
        assets.add(leftCone);

        // Center boundary (separating from open lane)
        const centerCone = coneModel.clone();
        centerCone.position.set(1, 0, z);
        assets.add(centerCone);
      }
    });

    // Load Advanced Warning Signs (New)
    loader.load('/models/roadsign__cones_pack.glb', (gltf) => {
      const signPack = gltf.scene;
      signPack.scale.set(12, 12, 12); // Reduced from 20 to 12 for better balance
      signPack.position.set(10, 0, 10); // Shifted slightly back left
      signPack.rotation.y = -Math.PI / 6;
      signPack.traverse(child => { if (child.isMesh) child.castShadow = true; });
      assets.add(signPack);
    });

    // Load Left Truck (Safety Vehicle - Parked in closed lane)
    loader.load('/models/truck.glb', (gltf) => {
      const truck = gltf.scene;
      truck.scale.set(1.5, 1.5, 1.5);
      truck.position.set(-4, 0, -15); // Clear of the taper end
      truck.rotation.y = Math.PI / 12;
      truck.traverse(child => { if (child.isMesh) child.castShadow = true; });
      assets.add(truck);
    });

    // Load Right Truck (Work Vehicle - Deep in work zone)
    loader.load('/models/truck.glb', (gltf) => {
      const truck = gltf.scene.clone();
      truck.scale.set(1.5, 1.5, 1.5);
      truck.position.set(-4, 0, -80); 
      truck.rotation.y = -Math.PI / 8;
      truck.traverse(child => { if (child.isMesh) child.castShadow = true; });
      assets.add(truck);
    });

    // Load Sign - REMOVED

    camera.position.set(8, 4, 20); // Zoomed in: Closer (Z=20) and Lower (Y=4)
    camera.lookAt(0, 1, -5); // Focused more on the road center

    let time = 0;
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    let mouseX = 0, mouseY = 0;
    let targetZoom = 20;
    let currentZoom = 20;

    const handleMouseMove = (e) => {
      mouseX = (e.clientX - window.innerWidth / 2) / 1000;
      mouseY = (e.clientY - window.innerHeight / 2) / 1000;
    };

    const handleWheel = (e) => {
      targetZoom += e.deltaY * 0.05;
      targetZoom = THREE.MathUtils.clamp(targetZoom, 5, 80);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('wheel', handleWheel, { passive: true });

    const animate = () => {
      const frameId = requestAnimationFrame(animate);
      time += 0.01;

      currentZoom = THREE.MathUtils.lerp(currentZoom, targetZoom, 0.05);

      // Emergency Light Flicker for both trucks
      leftTruckLight.intensity = 2 + Math.sin(time * 10) * 1.5;
      rightTruckLight.intensity = 2 + Math.cos(time * 12) * 1.5;

      // Animate Traffic Streaks
      streaks.forEach(s => {
        s.mesh.position.z += s.speed;
        if (s.speed > 0 && s.mesh.position.z > 150) s.mesh.position.z = -200;
        if (s.speed < 0 && s.mesh.position.z < -200) s.mesh.position.z = 150;
      });

      // Animate Welding Sparks (New)
      if (sparks) {
        const positions = sparks.geometry.attributes.position.array;
        for (let i = 0; i < sparksCount; i++) {
          positions[i*3] += (Math.random() - 0.5) * 0.2;
          positions[i*3+1] -= Math.random() * 0.1;
          positions[i*3+2] += (Math.random() - 0.5) * 0.2;
          
          if (positions[i*3+1] < -1) { // Reset spark
            positions[i*3] = 0;
            positions[i*3+1] = 0;
            positions[i*3+2] = 0;
          }
        }
        sparks.geometry.attributes.position.needsUpdate = true;
      }

      // Camera Movement Logic
      if (isExiting) {
        camera.position.z -= 1;
        camera.position.y -= 0.1;
        renderer.domElement.style.filter = `brightness(${Math.max(0, 1 - (targetZoom - camera.position.z) / 10)})`;
      } else {
        targetZoom -= 0.005; // Ambient dolly push
        camera.position.z = currentZoom;
        camera.position.x += (mouseX * 8 + 8 - camera.position.x) * 0.05;
        camera.position.y += (-mouseY * 4 + 4 - camera.position.y) * 0.05;
        camera.lookAt(0, 1, -10);
      }

      renderer.render(scene, camera);
    };
    const frameId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('wheel', handleWheel);
      cancelAnimationFrame(frameId);
      scene.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
          else object.material.dispose();
        }
      });
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [isExiting]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />;
};

export default RealisticBackground;
