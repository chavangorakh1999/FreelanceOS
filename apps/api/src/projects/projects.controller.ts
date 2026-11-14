import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth, AuthContext } from '../common/auth';
import { AddDependencyDto, CreateDeliverableDto, CreateMilestoneDto, CreateProjectDto, CreateTaskDto, ListProjectsQuery, ListTasksQuery, UpdateDeliverableDto, UpdateMilestoneDto, UpdateProjectDto, UpdateTaskDto } from './projects.dto';
import { ProjectsService } from './projects.service';
import { WorkService } from './work.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService, private readonly work: WorkService) {}

  @Get('projects') list(@Auth() a: AuthContext, @Query() q: ListProjectsQuery) { return this.projects.list(a, q); }
  @Post('projects') create(@Auth() a: AuthContext, @Body() dto: CreateProjectDto) { return this.projects.create(a, dto); }
  @Get('projects/:id') get(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.projects.get(a, id); }
  @Patch('projects/:id') update(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: UpdateProjectDto) { return this.projects.update(a, id, dto); }

  @Get('projects/:id/milestones') milestones(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.work.listMilestones(a, id); }
  @Post('projects/:id/milestones') addMilestone(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: CreateMilestoneDto) { return this.work.createMilestone(a, id, dto); }
  @Patch('milestones/:mid') updateMilestone(@Auth() a: AuthContext, @Param('mid', uuid) mid: string, @Body() dto: UpdateMilestoneDto) { return this.work.updateMilestone(a, mid, dto); }
  @Post('milestones/:mid/deliverables') addDeliverable(@Auth() a: AuthContext, @Param('mid', uuid) mid: string, @Body() dto: CreateDeliverableDto) { return this.work.addDeliverable(a, mid, dto); }
  @Patch('deliverables/:did') updateDeliverable(@Auth() a: AuthContext, @Param('did', uuid) did: string, @Body() dto: UpdateDeliverableDto) { return this.work.updateDeliverable(a, did, dto); }

  @Get('projects/:id/tasks') tasks(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Query() q: ListTasksQuery) { return this.work.listTasks(a, id, q); }
  @Post('projects/:id/tasks') addTask(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: CreateTaskDto) { return this.work.createTask(a, id, dto); }
  @Patch('tasks/:tid') updateTask(@Auth() a: AuthContext, @Param('tid', uuid) tid: string, @Body() dto: UpdateTaskDto) { return this.work.updateTask(a, tid, dto); }
  @Post('tasks/:tid/dependencies') addDependency(@Auth() a: AuthContext, @Param('tid', uuid) tid: string, @Body() dto: AddDependencyDto) { return this.work.addDependency(a, tid, dto.dependsOnTaskId); }
  @HttpCode(204) @Delete('tasks/:tid/dependencies/:dep') removeDependency(@Auth() a: AuthContext, @Param('tid', uuid) tid: string, @Param('dep', uuid) dep: string) { return this.work.removeDependency(a, tid, dep); }
}
