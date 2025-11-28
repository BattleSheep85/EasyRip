// DriveList Component - Displays available optical drives
import React from 'react';

function DriveList({ drives, selectedDrive, onSelectDrive, disabled }) {
  return (
    <section className="section">
      <h2>📀 Available Drives</h2>
      <div className="drive-list">
        {drives.map((drive) => (
          <div
            key={drive.id}
            className={`drive-card ${
              selectedDrive?.id === drive.id ? 'selected' : ''
            } ${disabled ? 'disabled' : ''}`}
            onClick={() => !disabled && onSelectDrive(drive)}
          >
            <div className="drive-icon">
              {drive.isBluray ? '💿' : '📀'}
            </div>
            <div className="drive-info">
              <h3>{drive.discName || 'Unknown Disc'}</h3>
              <p className="drive-type">
                {drive.isBluray ? 'Blu-ray' : 'DVD'}
              </p>
              <p className="drive-letter">{drive.driveLetter}</p>
              <p className="drive-description">{drive.description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default DriveList;
