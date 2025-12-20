import { useCallback, useMemo } from 'react';
import Particles from 'react-tsparticles';
import type { Engine } from 'tsparticles-engine';
import { loadSlim } from 'tsparticles-slim';

const readCssVariable = (variable: string, fallback: string) => {
    if (typeof window === 'undefined') return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(variable);
    return value?.trim() || fallback;
};

export default function ParticlesBackground() {
    const initParticles = useCallback(async (engine: Engine) => {
        await loadSlim(engine);
    }, []);

    const colors = useMemo(() => ({
        primary: readCssVariable('--primary-400', '#4caf50'),
        accent: readCssVariable('--accent-500', '#ff9800'),
        surface: readCssVariable('--surface-bg', '#0f0f0f'),
    }), []);

    return (
        <Particles
            id="yggdrasil-particles"
            init={initParticles}
            options={{
                fullScreen: { enable: true, zIndex: -1 },
                detectRetina: true,
                background: { color: 'transparent' },
                fpsLimit: 60,
                interactivity: {
                    detectsOn: 'canvas',
                    events: {
                        onHover: { enable: true, mode: 'repulse' },
                        onClick: { enable: true, mode: 'push' },
                        resize: true,
                    },
                    modes: {
                        push: { quantity: 2 },
                        repulse: { distance: 120, duration: 0.4 },
                        bubble: { distance: 200, size: 8, duration: 2 },
                    },
                },
                particles: {
                    color: { value: [colors.primary, colors.accent] },
                    links: {
                        color: colors.primary,
                        distance: 140,
                        enable: true,
                        opacity: 0.35,
                        width: 1,
                    },
                    move: {
                        direction: 'none',
                        enable: true,
                        outModes: { default: 'out' },
                        random: false,
                        speed: 1.25,
                        straight: false,
                    },
                    number: {
                        density: { enable: true, area: 1200 },
                        value: 65,
                    },
                    opacity: {
                        value: { min: 0.15, max: 0.5 },
                        animation: { enable: true, speed: 0.3, minimumValue: 0.1 },
                    },
                    shape: { type: ['circle', 'triangle', 'polygon'] },
                    size: {
                        value: { min: 1, max: 4 },
                        animation: { enable: true, speed: 2, minimumValue: 0.5 },
                    },
                    twinkle: {
                        particles: { enable: true, color: colors.accent, frequency: 0.01, opacity: 0.6 },
                        lines: { enable: true, color: colors.primary, frequency: 0.005, opacity: 0.5 },
                    },
                },
                pauseOnBlur: true,
            }}
        />
    );
}
