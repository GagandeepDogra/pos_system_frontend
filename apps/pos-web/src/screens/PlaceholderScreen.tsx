import { useI18n } from '../i18n/I18nProvider';
import { ScreenFrame } from '../components/ScreenFrame';
import { TopBar } from '../components/TopBar';

const TITLES: Record<string, string> = {
  tables: 'dashboard.dineIn',
  takeaway: 'dashboard.takeaway',
  kitchen: 'dashboard.kitchen',
  bills: 'dashboard.payment',
};

interface Props {
  screen: string;
  userName: string;
  onSwitchUser: () => void;
  onHome: () => void;
  onBack?: () => void;
}

/**
 * Frame for a staff screen whose content is built by a later work item
 * (tables, takeaway, kitchen board, payment). It already carries the top bar
 * with the user switch and the connection line.
 */
export function PlaceholderScreen({ screen, userName, onSwitchUser, onHome, onBack }: Props) {
  const { pair } = useI18n();
  return (
    <ScreenFrame
      title={pair(TITLES[screen] ?? 'app.name')}
      status={<TopBar userName={userName} onSwitchUser={onSwitchUser} />}
      onBack={onBack}
      onHome={onHome}
      className={`screen--${screen}`}
    >
      <div data-testid={`screen-${screen}`} />
    </ScreenFrame>
  );
}
