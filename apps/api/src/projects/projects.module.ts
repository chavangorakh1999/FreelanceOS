import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { WorkService } from './work.service';

@Module({ controllers: [ProjectsController], providers: [ProjectsService, WorkService] })
export class ProjectsModule {}
