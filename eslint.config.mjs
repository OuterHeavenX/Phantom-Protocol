// Lint config for the build-free source tree. There is no bundler and no
// package.json, so this is run directly:
//
//     npx eslint src data
//
// The rule that earns its place is no-undef. A template literal in hud.js
// referenced `engine` where the function only took (operative, ability); the
// HUD constructor threw and no run could start at all, and it shipped,
// because every test built the Engine directly and never went through the
// HUD. no-undef finds that in milliseconds. The rest are the errors that are
// always bugs, never style.

export default [
  {ignores:['assets/**','docs/**','tools/**']},
  {
    files:['**/*.js'],
    languageOptions:{
      ecmaVersion:2023,
      sourceType:'module',
      globals:{
        window:'readonly',document:'readonly',navigator:'readonly',location:'readonly',
        localStorage:'readonly',sessionStorage:'readonly',console:'readonly',
        performance:'readonly',requestAnimationFrame:'readonly',cancelAnimationFrame:'readonly',
        setTimeout:'readonly',clearTimeout:'readonly',setInterval:'readonly',clearInterval:'readonly',
        Image:'readonly',Audio:'readonly',AudioContext:'readonly',webkitAudioContext:'readonly',
        fetch:'readonly',URL:'readonly',Blob:'readonly',FileReader:'readonly',
        HTMLElement:'readonly',CustomEvent:'readonly',Event:'readonly',
        matchMedia:'readonly',getComputedStyle:'readonly',devicePixelRatio:'readonly',
        OffscreenCanvas:'readonly',ResizeObserver:'readonly',IntersectionObserver:'readonly',
        structuredClone:'readonly',queueMicrotask:'readonly',crypto:'readonly',
        alert:'readonly',screen:'readonly',history:'readonly',DOMParser:'readonly',
        Path2D:'readonly',ImageData:'readonly',createImageBitmap:'readonly',
        globalThis:'readonly',process:'readonly',
        CanvasPattern:'readonly',DOMMatrix:'readonly',btoa:'readonly',atob:'readonly',
        confirm:'readonly',prompt:'readonly'
      }
    },
    linterOptions:{reportUnusedDisableDirectives:false},
    rules:{
      'no-undef':'error',
      'no-dupe-keys':'error',
      'no-dupe-class-members':'error',
      'no-unsafe-negation':'error',
      'no-unreachable':'error',
      'no-const-assign':'error',
      'no-self-assign':'error',
      'no-setter-return':'error',
      'no-dupe-args':'error',
      'no-cond-assign':['error','always'],
      'no-constant-condition':'error',
      'use-isnan':'error',
      'valid-typeof':'error',
      'getter-return':'error',
      'no-obj-calls':'error',
      'no-sparse-arrays':'error',
      'no-func-assign':'error',
      'no-import-assign':'error',
      'no-class-assign':'error',
      'no-async-promise-executor':'error',
      'no-compare-neg-zero':'error',
      'no-duplicate-case':'error',
      'no-fallthrough':'error',
      'no-irregular-whitespace':'error',
      'no-prototype-builtins':'off',
      'no-empty':'off',
      'no-useless-escape':'error'
    }
  }
];
