import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import {
  CurrentUser,
  type RequestUser,
} from './decorator/current-user.decorator';
import { Public } from './decorator/public.decorator';
import { Roles } from './decorator/roles.decorator';
import { RequireSchoolAccess } from './decorator/school-access.decorator';
import { SchoolAccessGuard } from './guards/school-access.guard';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  create(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('change-password')
  changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user, dto);
  }

  @Post('logout')
  logout(
    @CurrentUser() user: RequestUser,
    @Body() body: { refreshToken?: string } = {},
  ) {
    return this.authService.logout(user, body.refreshToken);
  }

  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  @RequireSchoolAccess()
  @UseGuards(SchoolAccessGuard)
  @Get('sessions')
  getActiveSessions(@CurrentUser() user: RequestUser) {
    return this.authService.getActiveSessions(user);
  }

  @Get('me')
  getMe(@CurrentUser() user: RequestUser) {
    return user;
  }
}
