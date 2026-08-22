// Host half: an empty apply gives the Loader a host-side row; the browser half
// ships through exports["./client"]. The catalog routes it calls are mounted
// by the shell, so in a plain dsh the panel simply reports the bridge as
// unavailable.
export function apply(): void {}
