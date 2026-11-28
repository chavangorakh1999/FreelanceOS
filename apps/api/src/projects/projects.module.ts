import { Module } from '@nestjs/common';
import { ProjectsController, TimeController } from './projects.controller';
import { TimeService } from './time.service';
import { ProjectsService } from './projects.service';
import { WorkService } from './work.service';

@Module({ controllers: [ProjectsController, TimeController], providers: [ProjectsService, WorkService, TimeService] })
export class ProjectsModule {}
