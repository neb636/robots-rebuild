// Global patches to three.js shader chunks. Imported first so they apply to every program.
import * as THREE from 'three';

// Skip the BRDF for lights that can't reach this fragment. three.js evaluates every point and spot
// light for every lit pixel, even past a light's cutoff distance or outside its cone where the
// attenuated colour is exactly zero (`directLight.visible` is false). Every term of RE_Direct scales
// with that colour, so skipping it changes nothing on screen, but the street has a dozen lamps and
// most pixels are only in reach of a few, so this removes most of the lighting cost.
const RE_DIRECT = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const chunk = THREE.ShaderChunk.lights_fragment_begin;
if (!chunk.includes(RE_DIRECT)) console.warn('shaderpatches: lights_fragment_begin changed; light skipping not applied');
THREE.ShaderChunk.lights_fragment_begin = chunk.split(RE_DIRECT).join(`if ( directLight.visible ) { ${RE_DIRECT} }`);
