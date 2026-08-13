import { Modal } from './Modal';
import { averageScore, type GameStatistics } from '../stats';

interface Props {
  statistics: GameStatistics;
  onClose: () => void;
}

export function StatisticsPanel({ statistics, onClose }: Props) {
  const stats = [
    { label: 'Games played', value: statistics.gamesPlayed },
    { label: 'Highest combo', value: statistics.highestCombo },
    { label: 'Total lines', value: statistics.totalLines },
    { label: 'Average score', value: averageScore(statistics) },
    { label: 'Duo wins', value: statistics.duoWins },
  ];

  return (
    <Modal title="Game statistics" panelClassName="statistics-panel" onDismiss={onClose}>
      <p className="panel-note">Your lifetime results on this device.</p>
      <div className="lifetime-stat-grid">
        {stats.map((stat) => (
          <div className="lifetime-stat" key={stat.label}>
            <strong>{stat.value.toLocaleString()}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>
      {statistics.gamesPlayed === 0 && (
        <p className="panel-note">Finish a game to start building your stats.</p>
      )}
      <button className="btn primary" onClick={onClose} autoFocus>
        Done
      </button>
    </Modal>
  );
}
