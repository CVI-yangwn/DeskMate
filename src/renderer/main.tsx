import { createRoot } from 'react-dom/client';
import AvatarApp from './AvatarApp';
import PanelApp from './PanelApp';
import './styles.css';

const route = window.location.hash.replace(/^#\//, '') || 'panel';
document.body.dataset.route = route;

createRoot(document.getElementById('root')!).render(
  route === 'avatar' ? <AvatarApp /> : <PanelApp />,
);
