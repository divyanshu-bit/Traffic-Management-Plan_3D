import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';

const AbstractTerrain = ({ isExiting }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020617, 0.015); // Slightly lighter fog for more visibility

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // 2. High-Impact Terrain
    // Increased segments for smoother waves
    const geometry = new THREE.PlaneGeometry(160, 160, 100, 100);
    const count = geometry.attributes.position.count;
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));

    const material = new THREE.MeshBasicMaterial({
      wireframe: true,
      transparent: true,
      opacity: 0.4, // Increased opacity for visibility
      vertexColors: true,
      blending: THREE.AdditiveBlending,
    });
    
    const terrain = new THREE.Mesh(geometry, material);
    terrain.rotation.x = -Math.PI / 2.1;
    terrain.position.y = -10;
    scene.add(terrain);

    // 3. Dense Particle Cloud (Starfield/Data packets)
    const particlesGeometry = new THREE.BufferGeometry();
    const particlesCount = 2000; // Significantly more particles
    const posArray = new Float32Array(particlesCount * 3);

    for (let i = 0; i < particlesCount * 3; i++) {
      posArray[i] = (Math.random() - 0.5) * 200;
    }
    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

    const particlesMaterial = new THREE.PointsMaterial({
      size: 0.8, // Larger, more visible particles
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });

    const particlesMesh = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particlesMesh);

    camera.position.z = 50;
    camera.position.y = 15;

    let time = 0;
    let rippleFactor = 0;
    let autoRipple = 0;

    // 4. Events
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    let mouseX = 0;
    let mouseY = 0;
    const handleMouseMove = (e) => {
      mouseX = (e.clientX - window.innerWidth / 2) / 100;
      mouseY = (e.clientY - window.innerHeight / 2) / 100;
    };

    const handleClick = () => {
      rippleFactor = 4.0; // Aggressive burst on click
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleClick);

    // 5. Render Loop
    const animate = () => {
      const frameId = requestAnimationFrame(animate);
      time += 0.006;
      rippleFactor *= 0.94; // Fade out ripple
      
      // Secondary ambient ripple for life
      autoRipple = Math.sin(time * 0.5) * 2;

      const position = geometry.attributes.position;
      const color = geometry.attributes.color;

      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        
        // Multi-layered noise for more complex terrain
        const z1 = Math.sin(x * 0.05 + time) * Math.cos(y * 0.05 + time) * 6;
        const z2 = Math.sin(x * 0.1 - time * 0.5) * 2;
        const finalZ = (z1 + z2 + (rippleFactor * Math.sin(Math.sqrt(x*x + y*y) * 0.2 - time * 5)));
        
        position.setZ(i, finalZ);

        // Aggressive Color Mapping
        // Peaks: White-Cyan, Mid: Bright Blue, Valleys: Black-Blue
        const intensity = (finalZ + 8) / 16; 
        
        // Dynamic Glow Logic
        const r = THREE.MathUtils.lerp(0.0, 0.4, intensity);
        const g = THREE.MathUtils.lerp(0.2, 0.9, intensity);
        const b = THREE.MathUtils.lerp(0.4, 1.0, intensity);
        
        color.setXYZ(i, r, g, b);
      }
      
      position.needsUpdate = true;
      color.needsUpdate = true;

      // Accelerate if exiting
      if (isExiting) {
        camera.position.z -= 2;
        particlesMesh.position.z += 5;
        terrain.position.z += 1;
        renderer.domElement.style.filter = `blur(${Math.min(20, (50 - camera.position.z))}px)`;
      } else {
        // Parallax
        camera.position.x += (mouseX - camera.position.x) * 0.05;
        camera.position.y += (-mouseY + 15 - camera.position.y) * 0.05;
      }

      particlesMesh.rotation.y += 0.001;
      particlesMesh.rotation.x += 0.0005;

      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };

    const frameId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleClick);
      cancelAnimationFrame(frameId);
      
      geometry.dispose();
      material.dispose();
      particlesGeometry.dispose();
      particlesMaterial.dispose();
      renderer.dispose();
      
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [isExiting]);

  return <div ref={containerRef} className="abstract-terrain-container" style={{ position: 'absolute', inset: 0, zIndex: 1 }} />;
};

export default AbstractTerrain;
