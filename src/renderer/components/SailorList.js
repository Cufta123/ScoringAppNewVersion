import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import 'font-awesome/css/font-awesome.min.css';
import Flag from 'react-world-flags';
import iocToFlagCodeMap from '../constants/iocToFlagCodeMap';
import { confirmAction, reportError, reportInfo } from '../utils/userFeedback';

function SortTh({ col, label, sortCriteria, sortDirection, onSort }) {
  return (
    <th className="sortable" onClick={() => onSort(col)}>
      {label}{' '}
      {sortCriteria === col ? (
        <i
          className={`fa fa-sort-${sortDirection === 'asc' ? 'asc' : 'desc'}`}
        />
      ) : (
        <i className="fa fa-sort" style={{ opacity: 0.25 }} />
      )}
    </th>
  );
}

SortTh.propTypes = {
  col: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  sortCriteria: PropTypes.string.isRequired,
  sortDirection: PropTypes.string.isRequired,
  onSort: PropTypes.func.isRequired,
};

function SailorList({ sailors, onRemoveBoat, onRefreshSailors }) {
  const [sortCriteria, setSortCriteria] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [editingSailorId, setEditingSailorId] = useState(null);
  const [editedSailor, setEditedSailor] = useState({});
  const [isExpanded, setIsExpanded] = useState(true);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    const savedIsExpanded = localStorage.getItem('isExpanded');
    if (savedIsExpanded !== null) {
      setIsExpanded(JSON.parse(savedIsExpanded));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('isExpanded', JSON.stringify(isExpanded));
  }, [isExpanded]);

  const handleSort = (col) => {
    if (col === sortCriteria) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCriteria(col);
      setSortDirection('asc');
    }
  };

  const sortedSailors = [...sailors].sort((a, b) => {
    const dir = sortDirection === 'asc' ? 1 : -1;
    if (a[sortCriteria] < b[sortCriteria]) return -1 * dir;
    if (a[sortCriteria] > b[sortCriteria]) return 1 * dir;
    return 0;
  });

  useEffect(() => {
    const fetchCategories = async () => {
      const result = await window.electron.sqlite.sailorDB.readAllCategories();
      if (result) {
        setCategories(result);
      } else {
        reportError('Could not load category list.');
      }
    };

    fetchCategories();
  }, []);

  const handleEditClick = (sailor) => {
    setEditingSailorId(sailor.boat_id);
    setEditedSailor({
      ...sailor,
      originalName: sailor.name,
      originalSurname: sailor.surname,
      originalClubName: sailor.club,
    });
  };

  const handleSave = async () => {
    try {
      const sailorData = {
        originalName: editedSailor.originalName,
        originalSurname: editedSailor.originalSurname,
        name: editedSailor.name,
        surname: editedSailor.surname,
        category_name: editedSailor.category,
        club_name: editedSailor.club,
        originalClubName: editedSailor.originalClubName,
        boat_id: editedSailor.boat_id,
        sail_number: editedSailor.sail_number,
        country: editedSailor.country,
        model: editedSailor.model,
      };

      const result =
        await window.electron.sqlite.sailorDB.updateSailor(sailorData);

      if (!result) {
        reportError('Could not save sailor changes.');
        return;
      }

      setEditingSailorId(null);
      setEditedSailor({});
      onRefreshSailors();
      reportInfo('Sailor details saved successfully.', 'Saved');
    } catch (error) {
      reportError('Could not save sailor changes.', error);
    }
  };

  const handleRemoveWithConfirm = async (sailor) => {
    const confirmed = await confirmAction(
      `Remove boat ${sailor.sail_number} (${sailor.name} ${sailor.surname}) from this event?`,
      'Remove boat',
    );

    if (!confirmed) return;

    await onRemoveBoat(sailor.boat_id);
    reportInfo('Boat removed from event.', 'Removed');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setEditedSailor((prev) => ({ ...prev, [name]: value }));
  };

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const getFlagCode = (iocCode) => {
    return iocToFlagCodeMap[iocCode] || iocCode;
  };

  return (
    <div>
      <div className="sailor-list-header">
        <h2>
          <i className="fa fa-users" aria-hidden="true" />
          Registered Boats &amp; Sailors
        </h2>
        <button type="button" className="btn-ghost" onClick={toggleExpand}>
          <i
            className={`fa fa-chevron-${isExpanded ? 'up' : 'down'}`}
            aria-hidden="true"
          />
          {isExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {isExpanded && (
        <table>
          <thead>
            <tr>
              <SortTh
                col="country"
                label="Country"
                sortCriteria={sortCriteria}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortTh
                col="sail_number"
                label="Sail №"
                sortCriteria={sortCriteria}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortTh
                col="model"
                label="Model"
                sortCriteria={sortCriteria}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortTh
                col="name"
                label="Skipper"
                sortCriteria={sortCriteria}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortTh
                col="club"
                label="Club"
                sortCriteria={sortCriteria}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortTh
                col="category"
                label="Category"
                sortCriteria={sortCriteria}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedSailors.map((sailor) => (
              <tr key={`${sailor.boat_id}-${sailor.sail_number}`}>
                <td>
                  {editingSailorId === sailor.boat_id ? (
                    <input
                      type="text"
                      name="country"
                      value={editedSailor.country}
                      onChange={handleInputChange}
                      className="editable-input"
                    />
                  ) : (
                    <div>
                      <Flag
                        code={getFlagCode(sailor.country)}
                        style={{ width: '30px', marginRight: '5px' }}
                      />
                      <span>{sailor.country}</span>
                    </div>
                  )}
                </td>
                <td>
                  {editingSailorId === sailor.boat_id ? (
                    <input
                      type="text"
                      name="sail_number"
                      value={editedSailor.sail_number}
                      onChange={handleInputChange}
                      className="editable-input"
                    />
                  ) : (
                    sailor.sail_number
                  )}
                </td>
                <td>
                  {editingSailorId === sailor.boat_id ? (
                    <input
                      type="text"
                      name="model"
                      value={editedSailor.model}
                      onChange={handleInputChange}
                      className="editable-input"
                    />
                  ) : (
                    sailor.model
                  )}
                </td>
                <td>
                  {editingSailorId === sailor.boat_id ? (
                    <>
                      <input
                        type="text"
                        name="name"
                        value={editedSailor.name}
                        onChange={handleInputChange}
                        className="editable-input"
                      />
                      <input
                        type="text"
                        name="surname"
                        value={editedSailor.surname}
                        onChange={handleInputChange}
                        className="editable-input"
                      />
                    </>
                  ) : (
                    `${sailor.name} ${sailor.surname}`
                  )}
                </td>
                <td>
                  {editingSailorId === sailor.boat_id ? (
                    <input
                      type="text"
                      name="club"
                      value={editedSailor.club}
                      onChange={handleInputChange}
                      className="editable-input"
                    />
                  ) : (
                    sailor.club
                  )}
                </td>
                <td>
                  {editingSailorId === sailor.boat_id ? (
                    <select
                      name="category"
                      value={editedSailor.category}
                      onChange={handleInputChange}
                      className="editable-input"
                    >
                      {categories.map((category) => (
                        <option
                          key={category.category_id}
                          value={category.category_name}
                        >
                          {category.category_name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    sailor.category
                  )}
                </td>
                <td>
                  <div className="icon-container">
                    {editingSailorId === sailor.boat_id ? (
                      <i
                        className="fa fa-save"
                        aria-label="Save"
                        role="button"
                        tabIndex="0"
                        onClick={handleSave}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') handleSave();
                        }}
                        style={{
                          color: 'var(--teal)',
                          fontSize: '22px',
                          cursor: 'pointer',
                        }}
                      />
                    ) : (
                      <i
                        className="fa fa-pencil"
                        aria-label="Edit Boat"
                        role="button"
                        tabIndex="0"
                        onClick={() => handleEditClick(sailor)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' || e.key === ' ')
                            handleEditClick(sailor);
                        }}
                        style={{
                          color: 'var(--ocean)',
                          fontSize: '22px',
                          cursor: 'pointer',
                        }}
                      />
                    )}
                    <i
                      className="fa fa-trash"
                      aria-label="Remove Boat"
                      role="button"
                      tabIndex="0"
                      onClick={() => handleRemoveWithConfirm(sailor)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' || e.key === ' ')
                          handleRemoveWithConfirm(sailor);
                      }}
                      style={{
                        color: 'var(--danger)',
                        fontSize: '22px',
                        cursor: 'pointer',
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

SailorList.propTypes = {
  sailors: PropTypes.arrayOf(
    PropTypes.shape({
      boat_id: PropTypes.number.isRequired,
      country: PropTypes.string.isRequired,
      sail_number: PropTypes.number.isRequired,
      model: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      surname: PropTypes.string.isRequired,
      club: PropTypes.string.isRequired,
      category: PropTypes.string.isRequired,
    }),
  ).isRequired,
  onRemoveBoat: PropTypes.func.isRequired,
  onRefreshSailors: PropTypes.func.isRequired,
};

export default SailorList;
