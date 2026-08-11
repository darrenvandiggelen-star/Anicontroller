import './styles.css';
import { AnicontrollerApp } from './app';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('App root was not found.');

new AnicontrollerApp(root).start();
