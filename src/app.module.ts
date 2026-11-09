import { Module } from '@nestjs/common';
import { AssessmentComponentsModule } from './assessment-components/assessment-components.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { SchoolMembershipModule } from './school-membership/school-membership.module';
import { StudentModule } from './student/student.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { TeacherModule } from './teacher/teacher.module';
import { ClassesModule } from './classes/classes.module';
import { SubjectModule } from './subject/subject.module';
import { AttendanceModule } from './attendance/attendance.module';
import { ExaminationModule } from './examination/examination.module';
import { ResultModule } from './result/result.module';
import { FeeStructureModule } from './fee-structure/fee-structure.module';
import { InvoiceModule } from './invoice/invoice.module';
import { TimetableEntryModule } from './timetable-entry/timetable-entry.module';
import { AnnouncementModule } from './announcement/announcement.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AcademicSessionModule } from './academic-session/academic-session.module';
import { TermModule } from './term/term.module';
import { GuardianModule } from './parents/guardian/guardian.module';
import { PaymentsModule } from './payments/payments.module';
import { PlansModule } from './plans/plans.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { SchoolsModule } from './schools/schools.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { GradingModule } from './grading/grading.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    JwtModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    secret: configService.getOrThrow<string>('JWT_SECRET'),
    signOptions: {
      expiresIn: '15m',
    },
  }),
}),
    PrismaModule,
    AuthModule,
    SchoolMembershipModule,
    StudentModule,
    OnboardingModule,
    TeacherModule,
    ClassesModule,
    SubjectModule,
    AttendanceModule,
    ExaminationModule,
    ResultModule,
    FeeStructureModule,
    InvoiceModule,
    TimetableEntryModule,
    AnnouncementModule,
    NotificationsModule,
    DashboardModule,
    AuditLogModule,
    AcademicSessionModule,
    TermModule,
    GuardianModule,
    PaymentsModule,
    PlansModule,
    SubscriptionsModule,
    SchoolsModule,
    SuperAdminModule,
    GradingModule,
    AssessmentComponentsModule,
    
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}