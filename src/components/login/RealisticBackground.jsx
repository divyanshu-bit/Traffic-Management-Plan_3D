/**
 * RealisticBackground.jsx - Premium Traffic Edition
 * Blends photorealistic traffic elements with Neumorphic lighting.
 */

import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const ROAD_WIDTH = 24;

function cloneAsset(source) {
  const clone = source.clone(true);
  clone.traverse((node) => {
    if (node.isMesh) {
      node.material = Array.isArray(node.material) 
        ? node.material.map(m => m.clone()) 
        : node.material.clone();
    }
  });
  return clone;
}

function normalizeAsset(source) {
  const rotator = new THREE.Group();
  rotator.rotation.set(-Math.PI / 2, 0, 0);
  rotator.add(source);
  
  rotator.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rotator);
  
  const wrapper = new THREE.Group();
  rotator.position.y -= box.min.y;
  wrapper.add(rotator);
  
  return wrapper;
}

function makeAsphalt() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a0f'; ctx.fillRect(0, 0, 512, 512); // Very dark slate
  for (let i = 0; i < 20000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 40);
  return tex;
}

const RealisticBackground = ({ isExiting }) => {
  const containerRef = useRef(null);
  const isExitingRef = useRef(isExiting);
  useEffect(() => { isExitingRef.current = isExiting; }, [isExiting]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x09090b, 0.002); // Much lighter fog

    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 20); // Centered and higher

    // ── LIGHTING ─────────────────────────────────────────────────────────────
    // Strong ambient for visibility
    scene.add(new THREE.AmbientLight(0xffffff, 2.0));
    
    // Main directional (moonlight/blue tint)
    const mainLight = new THREE.DirectionalLight(0xffffff, 3.0);
    mainLight.position.set(40, 80, 20);
    scene.add(mainLight);

    // Accent Point Lights
    const p1 = new THREE.PointLight(0x0ea5e9, 200, 100, 1);
    p1.position.set(-8, 10, 0);
    scene.add(p1);

    const p2 = new THREE.PointLight(0x8b5cf6, 200, 100, 1);
    p2.position.set(8, 10, -30);
    scene.add(p2);

    // ── SCENE ELEMENTS ───────────────────────────────────────────────────────
    // Road
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_WIDTH, 500),
      new THREE.MeshStandardMaterial({ color: 0x111111, map: makeAsphalt(), roughness: 0.6, metalness: 0.3 })
    );
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -150);
    road.receiveShadow = true; scene.add(road);

    // Lane Markings
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
    const lineGeo = new THREE.PlaneGeometry(0.2, 500);
    const leftLine = new THREE.Mesh(lineGeo, lineMat);
    leftLine.rotation.x = -Math.PI / 2; leftLine.position.set(-ROAD_WIDTH/2 + 0.5, 0.05, -150); scene.add(leftLine);
    const rightLine = new THREE.Mesh(lineGeo, lineMat);
    rightLine.rotation.x = -Math.PI / 2; rightLine.position.set(ROAD_WIDTH/2 - 0.5, 0.05, -150); scene.add(rightLine);
    const centerLine = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 }));
    centerLine.rotation.x = -Math.PI / 2; centerLine.position.set(0, 0.05, -150); scene.add(centerLine);

    // Assets
    const loader = new GLTFLoader();
    const assetsGroup = new THREE.Group(); scene.add(assetsGroup);

    // 1. Cones - Forming a realistic lane closure (taper from left to center, then down the line)
    loader.load('/models/cone.glb', (gltf) => {
      const cone = normalizeAsset(gltf.scene); 
      cone.scale.set(0.4, 0.4, 0.4);
      
      // Taper from left edge to center
      for (let i = 0; i < 10; i++) {
        const c = cloneAsset(cone); 
        const t = i / 9;
        c.position.set(THREE.MathUtils.lerp(-11.5, -1, t), 0, THREE.MathUtils.lerp(15, -5, t)); 
        assetsGroup.add(c);
      }
      
      // Straight dividing line separating the work zone
      for (let i = 0; i < 25; i++) {
        const c = cloneAsset(cone); 
        c.position.set(-1, 0, -5 - i * 5); 
        assetsGroup.add(c);
      }
    });

    // 2. Trucks - Parked safely inside the closed left lane
    loader.load('/models/truck.glb', (gltf) => {
      const truck = normalizeAsset(gltf.scene);

      const addTruck = (x, z) => {
        const t = cloneAsset(truck);
        t.scale.set(1.5, 1.5, 1.5); 
        t.rotation.set(0, Math.PI, 0); // Only needs Y rotation to face camera
        t.position.set(x, 0, z); // PERFECTLY AT Y=0
        
        // Glowing warning light
        const light = new THREE.PointLight(0xf59e0b, 50, 20); // Amber warning
        light.position.set(0, 3, 0);
        t.add(light);
        
        assetsGroup.add(t);
      };
      // Place trucks inside the closed left lane
      addTruck(-6, -15); 
      addTruck(-6, -60);
    });

    // 3. Signs - Placed on the shoulders as advanced warnings
    loader.load('/models/sign.glb', (gltf) => {
      const signBase = normalizeAsset(gltf.scene);

      const addSign = (x, z, rY = 0) => {
        const s = cloneAsset(signBase);
        const box = new THREE.Box3().setFromObject(s); 
        const sz = new THREE.Vector3(); box.getSize(sz);
        const sc = 2.5 / Math.max(sz.x, sz.y, sz.z); 
        s.scale.set(sc, sc, sc);
        
        s.rotation.set(0, rY, 0); // Only needs Y rotation for angling
        s.position.set(x, 0, z); // PERFECTLY AT Y=0
        
        // Spotlight for the sign
        const sl = new THREE.PointLight(0xffffff, 20, 10, 2); 
        sl.position.set(x, 3, z + 1); 
        scene.add(sl);
        
        assetsGroup.add(s);
      };
      
      // Left shoulder (approaching work zone)
      addSign(-14, 25, Math.PI / 6); 
      addSign(-14, 0, Math.PI / 8); 
      
      // Right shoulder (advanced warning for opposite traffic or general info)
      addSign(14, 20, -Math.PI / 6); 
    });

    // 4. Traffic Streaks - Restricted to the open right lane
    const streaks = [];
    const addStreak = (x, color, spd) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.1, 15), 
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
      );
      m.position.set(x, 0.2, Math.random()*400-300); 
      streaks.push({ m, spd: spd*(2+Math.random()*3) }); 
      scene.add(m);
    };
    
    // Tail lights moving away (left side of open lane)
    for(let i=0; i<6; i++) addStreak(3, 0xff2244, -1.5); 
    
    // Headlights moving towards (right side of open lane)
    for(let i=0; i<6; i++) addStreak(9, 0xeef4ff, 1.5);  

    // ── ANIMATION LOOP ───────────────────────────────────────────────────────
    let time = 0, rafId, dZ = 25, br = 1;
    let lastTime = performance.now();

    const anim = (currentTime) => {
      rafId = requestAnimationFrame(anim);
      const delta = (currentTime - lastTime) / 1000 || 0.016;
      lastTime = currentTime;
      time += delta;
      
      // Move streaks
      streaks.forEach(s => { 
        s.m.position.z += s.spd * delta * 60; 
        if(s.spd > 0 && s.m.position.z > 100) s.m.position.z = -300; 
        if(s.spd < 0 && s.m.position.z < -300) s.m.position.z = 100; 
      });

      // Camera motion
      if (isExitingRef.current) {
        dZ -= 2.0 * delta * 60; 
        br = Math.max(0, br - 0.03 * delta * 60);
        renderer.domElement.style.opacity = br;
      } else {
        dZ -= 0.01 * delta * 60; 
        if (dZ < 8) dZ = 25;
      }
      
      camera.position.z = dZ;
      camera.lookAt(0, 1.5, -15);
      renderer.render(scene, camera);
    };
    anim(performance.now());

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, []);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }} />;
};

export default RealisticBackground;