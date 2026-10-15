export function useRouter(){return {refresh(){window.fixture.refreshes=(window.fixture.refreshes??0)+1;},push(path){window.fixture.navigations=(window.fixture.navigations??[]).concat(path);}};}
