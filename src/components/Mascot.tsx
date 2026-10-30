"use client";

// Doki, Canary's guide. A rigged GLB bird animated in code: bob, blink, talk (beak), wave, alarm, look at the cursor.
// The model ships with emissive-only materials and an inverted-hull outline, so we render it flat like a cartoon.
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

export type Mood = "idle" | "wave" | "talk" | "think" | "alarm" | "happy" | "point";

const URL = "/mascot/doki.glb";

type Bones = Record<string, THREE.Bone>;

function Bird({ mood, talking, lookAtPointer, flip, debug }: { mood: Mood; talking: boolean; lookAtPointer: boolean; flip?: boolean; debug?: Record<string, number[]> }) {
  const { scene } = useGLTF(URL);
  const root = useRef<THREE.Group>(null);
  const pointer = useRef({ x: 0, y: 0 });

  // Clone so several Dokis can be on screen, and flatten the materials.
  const { model, bones, rest } = useMemo(() => {
    const model = cloneSkinned(scene);
    const bones: Bones = {};
    const rest: Record<string, { q: THREE.Quaternion; p: THREE.Vector3; s: THREE.Vector3 }> = {};
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        bones[o.name] = o as THREE.Bone;
        rest[o.name] = { q: o.quaternion.clone(), p: o.position.clone(), s: o.scale.clone() };
      }
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isMesh) {
        const src = mesh.material as THREE.MeshStandardMaterial;
        const outline = /outline/i.test(src.name);
        mesh.material = new THREE.MeshBasicMaterial({
          color: src.emissive ? src.emissive.clone() : new THREE.Color("#ffd84d"),
          side: outline ? THREE.FrontSide : THREE.DoubleSide,
          toneMapped: false,
        });
        mesh.frustumCulled = false;
      }
    });
    return { model, bones, rest };
  }, [scene]);

  useEffect(() => {
    if (!lookAtPointer) return;
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [lookAtPointer]);

  const tmp = useMemo(() => ({ q: new THREE.Quaternion(), e: new THREE.Euler() }), []);
  const blink = useRef({ next: 1.5, t: -1 });

  const face = useRef({ x: 0, y: 0 });

  // rotate a bone from its rest pose by local euler (radians)
  const pose = (name: string, x: number, y: number, z: number) => {
    const b = bones[name];
    const r = rest[name];
    if (!b || !r) return;
    tmp.e.set(x, y, z);
    tmp.q.setFromEuler(tmp.e);
    b.quaternion.copy(r.q).multiply(tmp.q);
  };

  // reduced motion: read once and on change, not every frame
  const reduce = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => (reduce.current = mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const k = reduce.current ? 0 : 1;

    // body: bob + breathe; alarm = fast jitter; happy = hop
    if (root.current) {
      let y = Math.sin(t * 2.2) * 0.012 * k;
      let rz = Math.sin(t * 1.3) * 0.04 * k;
      if (mood === "happy") y = Math.abs(Math.sin(t * 5)) * 0.06 * k;
      if (mood === "alarm") rz = Math.sin(t * 28) * 0.05 * k;
      root.current.position.y = y;
      root.current.rotation.z = rz;
      const squash = 1 + Math.sin(t * 4.4) * 0.015 * k;
      root.current.scale.set(1 / squash, squash, 1 / squash);
    }

    // head: yaw = local z, nod = local x, roll = local y (measured on this rig)
    const tx = lookAtPointer ? pointer.current.x * (flip ? -1 : 1) : 0;
    const ty = lookAtPointer ? pointer.current.y : 0;
    face.current.x += (tx - face.current.x) * 0.08;
    face.current.y += (ty - face.current.y) * 0.08;
    const roll = mood === "think" ? 0.28 + Math.sin(t * 1.5) * 0.05 * k : mood === "happy" ? Math.sin(t * 5) * 0.08 * k : 0;
    pose("Face", face.current.y * 0.22, roll, -face.current.x * 0.4);

    // beak: the top beak stretches and drops to read as an open mouth
    const open = talking ? (Math.sin(t * 17) * 0.5 + 0.5) * (0.6 + Math.sin(t * 5.3) * 0.4) : mood === "alarm" ? 0.7 : 0;
    pose("BeakTop", -open * 0.9, 0, 0);
    const bt = bones.BeakTop;
    if (bt && rest.BeakTop) bt.scale.set(rest.BeakTop.s.x, rest.BeakTop.s.y, rest.BeakTop.s.z * (1 + open * 0.6));

    // eyes: round ovals by default; blink, wide when alarmed, squint when happy
    const bl = blink.current;
    if (t > bl.next) {
      bl.t = t;
      bl.next = t + 2.5 + Math.random() * 3;
    }
    const since = t - bl.t;
    const closed = since >= 0 && since < 0.13;
    const eye = mood === "alarm" ? { x: 0.72, z: 3.3 } : mood === "happy" ? { x: 0.75, z: 1.1 } : { x: 0.55, z: 2.6 };
    for (const [e, dir] of [["Eye_L", -1], ["Eye_R", 1]] as const) {
      pose(e, 0, dir * (mood === "happy" ? 0.15 : 0.4), 0);
      const b = bones[e];
      if (b && rest[e]) b.scale.set(rest[e].s.x * eye.x, rest[e].s.y, rest[e].s.z * (closed ? 0.25 : eye.z));
    }
    const cheeks = mood === "happy" ? 1.35 : mood === "alarm" ? 0.8 : 1;
    for (const c of ["Blush_L", "Blush_R"]) {
      const b = bones[c];
      if (b && rest[c]) b.scale.copy(rest[c].s).multiplyScalar(cheeks);
    }

    // wings: local x raises a wing; Arm_L is the wing on the viewer's right
    const flap = Math.sin(t * 16);
    if (mood === "wave") {
      pose("Arm_L", 1.15 + flap * 0.3 * k, 0, 0);
      pose("Arm_R", 0.1, 0, 0);
    } else if (mood === "alarm") {
      pose("Arm_L", 0.9 + flap * 0.45 * k, 0, 0);
      pose("Arm_R", 0.9 - flap * 0.45 * k, 0, 0);
    } else if (mood === "happy") {
      pose("Arm_L", 0.55 + flap * 0.2 * k, 0, 0);
      pose("Arm_R", 0.55 - flap * 0.2 * k, 0, 0);
    } else if (mood === "point") {
      pose("Arm_L", 0.25, 0.9, 0);
      pose("Arm_R", 0, 0, 0);
    } else if (mood === "think") {
      pose("Arm_R", 0.35, -0.6, 0);
      pose("Arm_L", 0, 0, 0);
    } else {
      const idle = Math.sin(t * 2.2) * 0.07 * k;
      pose("Arm_L", idle, 0, 0);
      pose("Arm_R", -idle, 0, 0);
    }
    if (debug) for (const [n, v] of Object.entries(debug)) {
      if (n.endsWith(":s")) { const b = bones[n.slice(0, -2)]; const r = rest[n.slice(0, -2)]; if (b && r) b.scale.set(r.s.x * v[0], r.s.y * v[1], r.s.z * v[2]); }
      else pose(n, v[0], v[1], v[2]);
    }
  });

  return (
    <group scale={flip ? [-1, 1, 1] : 1}>
      <group ref={root}>
        <primitive object={model} />
      </group>
    </group>
  );
}

export function Mascot({
  mood = "idle",
  talking = false,
  lookAtPointer = true,
  className,
  flip,
  label = "Doki the canary, Canary's guide",
  debug,
  distance = 1.45,
}: {
  debug?: Record<string, number[]>;
  /** camera distance: larger shows more room around Doki */
  distance?: number;
  mood?: Mood;
  talking?: boolean;
  lookAtPointer?: boolean;
  className?: string;
  flip?: boolean;
  label?: string;
}) {
  // Only draw while Doki is on screen and the tab is visible; otherwise three.js burns battery for nothing.
  const box = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  // phones: cap the pixel ratio, a cartoon bird doesn't need 3x
  const [maxDpr, setMaxDpr] = useState(2);
  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState !== "hidden");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    let io: IntersectionObserver | undefined;
    if (box.current && "IntersectionObserver" in window) {
      io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: "120px" });
      io.observe(box.current);
    }
    if (window.matchMedia("(max-width: 767px), (pointer: coarse)").matches) setMaxDpr(1.5);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      io?.disconnect();
    };
  }, []);

  return (
    <div ref={box} className={className} role="img" aria-label={label}>
      <Canvas
        frameloop={onScreen && tabVisible ? "always" : "never"}
        aria-hidden
        dpr={[1, maxDpr]}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        camera={{ position: [0, 0.22, distance], fov: 30 }}
        onCreated={({ camera }) => camera.lookAt(0, 0.2, 0)}
      >
        <Suspense fallback={null}>
          <Bird mood={mood} talking={talking} lookAtPointer={lookAtPointer} flip={flip} debug={debug} />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload(URL);
