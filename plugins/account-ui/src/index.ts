// Host half: an empty apply gives the Loader a host-side row; the browser
// half ships through exports["./client"]. The bridge routes it talks to are
// mounted by the shell, so in a plain dsh this section simply reports the
// bridge as unavailable (probe-style degradation).
export function apply(): void {}
