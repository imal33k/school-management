import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RequestUser } from './decorator/current-user.decorator';

import { PrismaService } from '../prisma/prisma.service';

import * as bcrypt from 'bcrypt';

import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        email: registerDto.email,
      },
    });

    if (existingUser) {
      throw new ConflictException('This email already exists');
    }

    const hashedPassword = await bcrypt.hash(
      registerDto.password,
      10,
    );

    const user = await this.prisma.user.create({
      data: {
        email: registerDto.email,
        password: hashedPassword,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        phone: registerDto.phone,
        role: UserRole.SCHOOL_ADMIN,
      },
    });

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
    };
  }


  async changePassword(user: RequestUser, dto: ChangePasswordDto) {
    const existing = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!existing) throw new UnauthorizedException('User not found');
    const valid = await bcrypt.compare(dto.currentPassword, existing.password);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');
    await this.prisma.user.update({ where: { id: existing.id }, data: { password: await bcrypt.hash(dto.newPassword, 10) } });
    return { message: 'Password changed successfully' };
  }

  async login(loginDto: LoginDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        email: loginDto.email,
      },
    });

    if (!existingUser) {
      throw new UnauthorizedException(
        'This user does not exist',
      );
    }

    const passwordMatch = await bcrypt.compare(
      loginDto.password,
      existingUser.password,
    );

    if (!passwordMatch) {
      throw new UnauthorizedException(
        'Invalid email or password',
      );
    }

    const payload = {
      sub: existingUser.id,
      email: existingUser.email,
      role: existingUser.role,
    };

    const token = await this.jwtService.signAsync(payload);

    return {
      access_token: token,
    };
  }
}