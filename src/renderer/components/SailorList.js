import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import 'font-awesome/css/font-awesome.min.css';
import Flag from 'react-world-flags';
import iocToFlagCodeMap from '../constants/iocToFlagCodeMap';

const categoryOptions = ['KADET', 'SENIOR', 'JUNIOR', 'MASTER', 'CADET'];

function SailorList({ sailors, onRemoveBoat, onRefreshSailors }) {
  const [sortCriteria, setSortCriteria] = useState('name');
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

  const sortedSailors = [...sailors].sort((a, b) => {
    if (a[sortCriteria] < b[sortCriteria]) return -1;
    if (a[sortCriteria] > b[sortCriteria]) return 1;
    return 0;
  });

  useEffect(() => {
    const fetchCategories = async () => {
      const result = await window.electron.sqlite.sailorDB.readAllCategories();
      if (result) {
        setCategories(result);
      } else {
        console.error('Failed to fetch categories');
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

    console.log('Saving sailor and boat:', sailorData); // Log the data being sent

    const result =
      await window.electron.sqlite.sailorDB.updateSailor(sailorData);
    if (result) {
      console.log('Save successful:', result); // Log the result
      // Reset editing state
      setEditingSailorId(null);
      setEditedSailor({});
      // Refresh the list of sailors
      onRefreshSailors();
    } else {
      console.error('Save failed');
      // Handle error
    }
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
      <style>
        {`
          .icon-container {
            display: flex;
            justify-content: start;
            gap: 20px;
          }

          @media (max-width: 600px) {
            .icon-container {
              gap: 5px;
            }
          }

          .editable {
            border-bottom: 1px dashed #ccc;
            cursor: text;
            background-color: #f9f9f9;
          }

          .editable:hover {
            background-color: #e0e0e0;
          }

          .editable-input {
            border: none;
            background: transparent;
            border-bottom: 1px dashed #ccc;
            width: 100%;
          }
        `}
      </style>
      <button type="button" onClick={toggleExpand}>
        {isExpanded ? 'Collapse Sailor List' : 'Expand Sailor List'}
      </button>
      {isExpanded && (
        <>
          <label htmlFor="sortCriteria">Sort by: </label>
          <select
            id="sortCriteria"
            value={sortCriteria}
            onChange={(e) => setSortCriteria(e.target.value)}
          >
            <option value="name">Name</option>
            <option value="surname">Surname</option>
            <option value="club">Club</option>
            <option value="sail_number">Sail Number</option>
            <option value="model">Boat Model</option>
          </select>
          <table>
            <thead>
              <tr>
                <th>Country</th>
                <th>Sail Number</th>
                <th>Model</th>
                <th>Skipper</th>
                <th>Club</th>
                <th>Category</th>
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
                            if (e.key === 'Enter' || e.key === ' ')
                              handleSave();
                          }}
                          style={{
                            color: 'green',
                            fontSize: '24px',
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
                            color: 'blue',
                            fontSize: '24px',
                            cursor: 'pointer',
                          }}
                        />
                      )}
                      <i
                        className="fa fa-trash"
                        aria-label="Remove Boat"
                        role="button"
                        tabIndex="0"
                        onClick={() => onRemoveBoat(sailor.boat_id)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' || e.key === ' ')
                            onRemoveBoat(sailor.boat_id);
                        }}
                        style={{
                          color: 'red',
                          fontSize: '24px',
                          cursor: 'pointer',
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
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
