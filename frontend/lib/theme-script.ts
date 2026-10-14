// Runs before first paint (inlined in <head>) so the page never flashes the wrong appearance.
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem("theme");var d=m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
