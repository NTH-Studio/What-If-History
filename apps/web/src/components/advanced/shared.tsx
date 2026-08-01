import type { Difficulty, GameRegion } from '@what-if-history/contracts';
import styles from '../../styles/App.module.css';

export const difficulties: Difficulty[] = ['very_easy', 'easy', 'normal', 'hard', 'impossible'];
export const regionTypes: GameRegion['regionType'][] = ['land', 'coastal', 'ocean', 'strait'];

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className={styles.workspaceHeader}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
