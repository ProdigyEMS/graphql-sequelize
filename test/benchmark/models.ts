import {createSequelize} from '../support/helper.ts';
import Sequelize from 'sequelize';

type BenchmarkModel = ReturnType<ReturnType<typeof createSequelize>['define']>;
type HasManyAssociation = ReturnType<BenchmarkModel['hasMany']>;
type BelongsToAssociation = ReturnType<BenchmarkModel['belongsTo']>;
type BelongsToManyAssociation = ReturnType<BenchmarkModel['belongsToMany']>;
const sequelize = createSequelize({
  pool: {
    max: 25
  }
});

const User = sequelize.define('user', {
  name: Sequelize.STRING
}, {
  timestamps: false
}) as BenchmarkModel & {
  Tasks: HasManyAssociation;
  Subordinates: HasManyAssociation;
  Projects: BelongsToManyAssociation;
};

const Task = sequelize.define('task', {
  name: Sequelize.STRING,
  completed: Sequelize.BOOLEAN
}, {
  timestamps: false
}) as BenchmarkModel & {
  User: BelongsToAssociation;
  SubTask: HasManyAssociation;
};

const Project = sequelize.define('project', {}) as BenchmarkModel & {
  Users: BelongsToManyAssociation;
};
const ProjectUser = sequelize.define('project_user', {});

User.Tasks = User.hasMany(Task, {as: 'taskItems', foreignKey: 'user_id'});
User.Subordinates = User.hasMany(User, { as: 'subordinates', foreignKey: 'manager_id', constraints: false });
Task.User = Task.belongsTo(User, { foreignKey: 'user_id' });
Task.SubTask = Task.hasMany(Task, { as: 'subTasks', foreignKey: 'parent_id', constraints: false});
Project.Users = Project.belongsToMany(User, { through: ProjectUser, foreignKey: 'project_id', otherKey: 'user_id' });
User.Projects = User.belongsToMany(Project, { through: ProjectUser, foreignKey: 'user_id', otherKey: 'project_id' });

const models = {
  User,
  Task,
  Project,
  ProjectUser
};

export {
  sequelize,
  models
};
