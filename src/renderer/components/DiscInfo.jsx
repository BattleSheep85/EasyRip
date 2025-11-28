// DiscInfo Component - Shows detailed information about selected disc
import React from 'react';

function DiscInfo({ discInfo, selectedDrive, outputPath }) {
  return (
    <section className="section disc-info">
      <h2>💽 Disc Information</h2>

      <div className="info-grid">
        <div className="info-item">
          <label>Disc Name:</label>
          <span>{discInfo.discName || 'Unknown'}</span>
        </div>

        <div className="info-item">
          <label>Type:</label>
          <span>{selectedDrive?.isBluray ? 'Blu-ray' : 'DVD'}</span>
        </div>

        <div className="info-item">
          <label>Drive:</label>
          <span>{selectedDrive?.driveLetter}</span>
        </div>

        <div className="info-item">
          <label>Output Path:</label>
          <span className="output-path">{outputPath}</span>
        </div>
      </div>

      {discInfo.titles && discInfo.titles.length > 0 && (
        <div className="titles-info">
          <h3>Titles Found: {discInfo.titles.length}</h3>
          <p className="info-note">
            Full disc backup will include all titles and extras
          </p>
        </div>
      )}
    </section>
  );
}

export default DiscInfo;
