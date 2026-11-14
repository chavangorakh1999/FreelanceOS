import { MilestoneStatus, ProjectStatus, TaskPriority, TaskStatus, Visibility } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsOptional, IsString, IsUUID, IsIn, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PageQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateProjectDto {
  /** Optional when an engagement is given: the client is taken from it. */
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() engagementId?: string;
  /** Must be ACCEPTED. Seeds the first scope draft from the accepted version. */
  @IsOptional() @IsUUID() proposalId?: string;
  /** Must be SIGNED. */
  @IsOptional() @IsUUID() agreementId?: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @Type(() => Date) @IsDate() startDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() targetDate?: Date;
}

export class UpdateProjectDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsEnum(ProjectStatus) status?: ProjectStatus;
  @IsOptional() @Type(() => Date) @IsDate() startDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() targetDate?: Date;
  @IsOptional() @IsEnum(Visibility) visibility?: Visibility;
}

export class ListProjectsQuery extends PageQuery {
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsEnum(ProjectStatus) status?: ProjectStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
}

export class CreateMilestoneDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @Type(() => Date) @IsDate() dueDate?: Date;
}

export class UpdateMilestoneDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @Type(() => Date) @IsDate() dueDate?: Date;
  @IsOptional() @IsEnum(MilestoneStatus) status?: MilestoneStatus;
}

export class CreateDeliverableDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsUUID() scopeItemKey?: string;
}

export class UpdateDeliverableDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsBoolean() done?: boolean;
}

export class CreateTaskDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MaxLength(5000) internalNotes?: string;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @Type(() => Date) @IsDate() dueDate?: Date;
  @IsOptional() @IsUUID() milestoneId?: string;
  @IsOptional() @IsEnum(Visibility) visibility?: Visibility;
  /** Quick add into a board column. */
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @IsOptional() @IsUUID() assigneeUserId?: string;
  @IsOptional() @IsUUID() assigneeContactId?: string;
}

export class UpdateTaskDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MaxLength(5000) internalNotes?: string;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  /** Pass null to detach from its milestone. */
  @IsOptional() @IsUUID() milestoneId?: string | null;
  @IsOptional() @IsEnum(Visibility) visibility?: Visibility;
  /** Pass null to unassign. Setting one kind of assignee clears the other. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() assigneeUserId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() assigneeContactId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Date) @IsDate() dueDate?: Date | null;
}

export class ListTasksQuery {
  @IsOptional() @IsUUID() milestoneId?: string;
  @IsOptional() @IsIn(['me', 'client', 'none']) assignee?: 'me' | 'client' | 'none';
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
}

export class AddDependencyDto {
  @IsUUID() dependsOnTaskId: string;
}
