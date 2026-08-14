import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { AppConfig } from '../config/configuration';
import { UsersModule } from '../users/users.module';
import { AuthService } from './application/auth.service';
import { AuthController } from './presentation/auth.controller';
import { JwtStrategy } from './presentation/jwt.strategy';

@Module({
  imports: [
    UsersModule, // AuthService only ever talks to UsersService.validateCredentials(), never touches Prisma
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const auth = config.get('auth', { infer: true });
        // @nestjs/jwt types expiresIn as `ms`'s StringValue ("15m", "1d", ...)
        // rather than plain string — JWT_ACCESS_TTL is already documented in
        // .env.example to use exactly that format, so this cast is just
        // bridging configuration.ts's plain-string AppConfig type to it.
        return {
          secret: auth.jwtSecret,
          signOptions: {
            expiresIn: auth.accessTtl as `${number}${'s' | 'm' | 'h' | 'd'}`,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule], // so other modules' guards (JwtAuthGuard -> JwtStrategy) resolve without re-registering JwtModule
})
export class AuthModule {}
