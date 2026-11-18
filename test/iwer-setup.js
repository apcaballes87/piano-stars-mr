import { XRDevice, metaQuest3 } from 'iwer';
const dev = new XRDevice(metaQuest3);
dev.installRuntime({ forceInstall: true });
dev.primaryInputMode = 'hand';
window.__dev = dev;
