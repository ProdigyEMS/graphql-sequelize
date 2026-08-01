import {pathToFileURL} from 'node:url';

import {models, sequelize} from './models.js';

const NO_USERS = 1000;
const NO_TASKS = 10000;
const NO_SUBTASKS = 10;
const NO_PROJECTS = 10;

/**
 * Return a random integer between one and the supplied maximum.
 *
 * @param {number} max inclusive upper bound
 * @return {number} random integer
 */
function randomInt(max) {
  const min = 1;

  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Reset and populate the benchmark database.
 *
 * @return {Promise<void>} resolves after all fixtures are written and closed
 */
export function seedBenchmarkDatabase() {
  return sequelize.sync({ force: true, logging: console.log }).then(function () {
    let users = [];

    for (var i = 0; i < NO_USERS; i++) {
      users.push({
        name: Math.random().toString(),
        manager_id: randomInt(NO_USERS) // eslint-disable-line
      });
    }

    return models.User.bulkCreate(users);
  }).then(function () {
    let tasks = [];

    for (var i = 0; i < NO_TASKS; i++) {
      tasks.push({
        name: Math.random().toString(),
        completed: Math.random() > 0.5,
        user_id: randomInt(NO_USERS) // eslint-disable-line
      });
    }

    return models.Task.bulkCreate(tasks);
  }).then(() => {
    let subTasks = [];

    for (var i = 1; i <= NO_TASKS; i++) {
      for (var j = 0; j < NO_SUBTASKS; j++) {
        subTasks.push({
          name: Math.random().toString(),
          completed: Math.random() > 0.5,
          parent_id: i // eslint-disable-line
        });
      }
    }

    return models.Task.bulkCreate(subTasks);
  }).then(() => {
    let projects = [];

    for (var i = 0; i < NO_PROJECTS; i++) {
      projects.push({});
    }

    return models.Project.bulkCreate(projects);
  }).then(() => {
    let projectUsers = [];

    for (var i = 1; i <= NO_PROJECTS; i++) {
      let userIds = [];
      while (userIds.length < 25) {
        let userId = randomInt(NO_USERS);
        if (userIds.indexOf(userId) === -1) {
          userIds.push(userId);
        }
      }
      /* eslint-disable camelcase */
      userIds.forEach(user_id => {
        projectUsers.push({
          project_id: i,
          user_id
        });
      });
      /* eslint-enable camelcase */
    }

    return models.ProjectUser.bulkCreate(projectUsers);
  }).catch(e => {
    console.log(e);
    throw e;
  }).then(() => sequelize.close());
}

const executedModuleUrl = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (import.meta.url === executedModuleUrl) {
  await seedBenchmarkDatabase();
}
